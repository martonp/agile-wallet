# Agile Wallet

A Chrome-extension wallet for an Ethereum smart account that can require any mix of signature
schemes (today ECDSA, Falcon-512 and SPHINCS-) and change that mix over time. Its transactions are
EIP-8141 frame transactions, carried by the **Virtual Precompile Rule (VPR)**: an alternative
mempool in which post-quantum signature checks fit the validation budget, without staking.

## How it works

**One seed, many keys.** The extension keeps one 24-word mnemonic and derives every key from it:
ECDSA with BIP-32 (`m/44'/60'/a'/0/i`), Falcon and SPHINCS- from
`HMAC-SHA512(seed, "agile-wallet/<label>/" ‖ a ‖ i)` with the labels `falcon-512` and `sphincs`.
Each account is one `a` (hardened in BIP-32) with `i = 0`, so every account has its own keys and wallet.

**The account.** `AgileWallet` holds a list of schemes, each a verifier contract plus a public key
(or native ECDSA: an address), and stores only the list's hash. A transaction carries the list and
one signature per scheme; the wallet's VERIFY frame checks each signature with its verifier, then
approves the transaction. ECDSA uses the transaction's own SECP256K1 signature, which the protocol
verifies; the wallet only checks its signer.

- Any signature scheme works: adding one means deploying a new verifier, not changing the wallet.
- Changing the list (`setSchemes`) needs signatures from both the old and the new schemes.
- The address depends only on the owner's ECDSA address, so it is known before deployment,
  whatever schemes the wallet starts with. The first transaction deploys the wallet and also
  carries the owner's ECDSA signature.

**Verifiers.** Every post-quantum scheme has an `IVerifier` adapter in `contracts/src`:

| Scheme | Verifies with | EVM gas per verification |
|---|---|---|
| ECDSA | the protocol (SECP256K1 signature) | none |
| Falcon-512 | ZKNOX `falcon8` | 590k–635k |
| SPHINCS- C13 | nconsigny's `SphincsC13Asm` | 97k |

## The Virtual Precompile Rule

The canonical EIP-8141 mempool limits a transaction's validation to `MAX_VERIFY_GAS` (100,000 gas).
One Falcon or SPHINCS- verification uses that up on its own, while a native precompile would cost a
few thousand (EIP-8052 prices Falcon at 3,000). VPR is the canonical mempool with two changes. First,
calls to listed verifier functions count at their precompile price instead of their EVM cost. The
extra allowance belongs to the verification code, which is the same for every sender, so nobody
needs to stake. Second, validation may read the one slot of a listed break signal: a one-way flag a
cryptographer raises when a scheme is broken, after which subscribed wallets also require a backup
scheme. The slot changes at most once, so it can invalidate pending transactions at most once. The
spec is [`docs/VPR.md`](docs/VPR.md), and its IPFS CIDv0 is the mempool's ID and gossip
topic: `QmPPr52xDYmAATRiNio6mzNEj8WXmgiMmCt16HwNxWrCrU` (`python3 scripts/mempool-id.py docs/VPR.md`).

The rule runs in our fork of the alt-mempool sidecar (`sidecar/`). It needs ethrex to report the gas
of each call in its trace ([martonp/ethrex](https://github.com/martonp/ethrex), branch
`vpr-call-gas`); until that is deployed, the sidecar substitutes measured costs.

## Repository

| Path | |
|---|---|
| `contracts/` | Foundry: verifiers, `AgileWallet`, factory, `BreakSignal`, deploy script |
| `extension/` | Chrome MV3 extension (React, Vite); see its README |
| `sidecar/` | Alt-mempool sidecar fork with the VPR rule |
| `scripts/` | Devnet scripts: verifier gas measurement, end-to-end transaction, mempool ID |
| `signal-ui/` | The cryptographer's page for raising a break signal |
| `docs/VPR.md` | The VPR spec |

## Running the demo

Needs an EIP-8141 devnet with the deterministic deployment proxy (for example the alt-mempool
workshop's docker-compose devnet: ethrex, Lighthouse, chain 1337), Foundry, Bun, Node and Cargo.
Each step starts from the repository root.

```bash
# 1. The SPHINCS- signer
(cd contracts/lib/SPHINCS-/signers/signer-wasm && cargo build --release --bin signer-c13)
# 2. Contracts (deployed code costs state gas after Amsterdam, hence the multiplier)
(cd contracts && forge build && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 \
  --private-key $FUNDED_KEY --broadcast --slow --legacy --gas-estimate-multiplier 900)
# 3. The VPR sidecar, in its own terminal; it gossips on the VPR topic
#    (another VPR node joins with --p2p.bootEnrs <the ENR this one logs>)
(cd sidecar && bun install && bun run build && ./skandha node \
  --configFile ../scripts/vpr-sidecar.config.json --api.port 14338 --api.wsPort 14338 \
  --p2p.port 4338 --p2p.enrPort 4338 --redirectRpc --executor.bundlingMode auto)
# 4. A wallet transaction through it
(cd scripts && npm install && FUNDER_KEY=$FUNDED_KEY SCHEMES=sphincs node send-wallet-tx.mjs)
# 5. Break signals: an ECDSA wallet subscribes with SPHINCS- as its backup, then sends with ECDSA alone
(cd scripts && SEED=demo-signal SCHEMES=ecdsa FUNDER_KEY=$FUNDED_KEY node send-wallet-tx.mjs \
  && SEED=demo-signal SCHEMES=ecdsa SET_RULES=sphincs node send-wallet-tx.mjs \
  && SEED=demo-signal SCHEMES=ecdsa RULES=sphincs node send-wallet-tx.mjs)
# 6. The cryptographer raises the signal. It is Anvil's test account #1 (CRYPTOGRAPHER_KEY: the well-known key
#    Anvil prints for it); fund it first. Then either use signal-ui/ (npx serve signal-ui, and connect a browser
#    wallet holding that key) or a terminal. It can't be undone: from then on the wallet's transactions also need
#    SPHINCS- (step 5's last command signs for it).
cast send 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --value 1ether --private-key $FUNDED_KEY \
  --rpc-url http://127.0.0.1:8545 --legacy
cast send 0x108c7aD6Dd81EA131A761B3Db9F817056D26941c "signalBroken()" --private-key $CRYPTOGRAPHER_KEY \
  --rpc-url http://127.0.0.1:8545 --legacy
```

## Status

- On a local devnet, a SPHINCS- wallet's first transaction (deploy and transfer) and a second
  transfer were admitted through VPR and mined. The canonical mempool would reject both. With two
  VPR nodes peered, a transaction sent to one was gossiped on the VPR topic to the other.
- Wallets with Falcon (alone or with ECDSA and SPHINCS-) send through VPR only thanks to the
  sidecar's stand-in credit, 750,000 gas per Falcon call, which also covers the wallet's margin for
  Falcon's varying cost (588k–636k). With exact per-call gas, a Falcon wallet's first (deploying)
  transaction would need about 110,000–120,000 of the 100,000 budget.
- The extension creates, stores and unlocks the wallet and signs with ECDSA, Falcon and
  SPHINCS-; it does not send transactions yet.
- The sidecar matches verifiers by their configured addresses; it does not yet check code hashes
  or function selectors, and its base rules are the standard alt-mempool's rather than exactly the
  canonical mempool's.
- falcon.js never seeds its signing randomness, a known prototype limitation.
- The cryptography (ZKNOX Falcon, SPHINCS-, falcon.js) is research code and unaudited. Don't use
  this with real funds.

How AI was used: [`AI_USAGE.md`](AI_USAGE.md).
