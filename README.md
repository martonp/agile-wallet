# Agile Wallet

A Chrome-extension wallet for an Ethereum smart account that can require any mix of signature
schemes (today ECDSA, Falcon-512 and SPHINCS-) and change that mix over time. Its transactions are
EIP-8141 frame transactions, carried by the **Virtual Precompile Rule (VPR)**: an alternative
mempool in which post-quantum signature checks fit the validation budget, without staking.

## How it works

**One seed, many keys.** The extension keeps one 24-word mnemonic and derives every key from it:
ECDSA with BIP-32 (`m/44'/60'/a'/0/i`), Falcon and SPHINCS- from
`HMAC-SHA512(seed, "agile-wallet/<label>/" ‖ a ‖ i)` with the labels `falcon-512` and `sphincs`.

**The account.** `AgileWallet` holds a list of schemes, each a verifier contract plus a public key,
and stores only the list's hash. A transaction carries the list and one signature per scheme; the
wallet's VERIFY frame checks each signature with its verifier, then approves the transaction.

- Any signature scheme works: adding one means deploying a new verifier, not changing the wallet.
- Changing the list (`setSchemes`) needs signatures from both the old and the new schemes.
- The address depends only on the owner's ECDSA address, so it is known before deployment,
  whatever schemes the wallet starts with. The first transaction deploys the wallet and also
  carries the owner's ECDSA signature.

**Verifiers.** Every scheme has an `IVerifier` adapter in `contracts/src`:

| Scheme | Verifies with | EVM gas per verification |
|---|---|---|
| ECDSA | `ecrecover` | ~5k |
| Falcon-512 | ZKNOX `falcon8` | 590k–635k |
| SPHINCS- C13 | nconsigny's `SphincsC13Asm` | 97k |

## The Virtual Precompile Rule

The canonical EIP-8141 mempool limits a transaction's validation to `MAX_VERIFY_GAS` (100,000 gas).
One Falcon or SPHINCS- verification uses that up on its own, while a native precompile would cost a
few thousand (EIP-8052 prices Falcon at 3,000). VPR is the canonical mempool with one change: calls
to listed verifier functions count at their precompile price instead of their EVM cost. The extra
allowance belongs to the verification code, which is the same for every sender, so nobody needs to
stake. The spec is [`docs/VPR.md`](docs/VPR.md), and its IPFS CIDv0 is the mempool's ID and gossip
topic: `QmRD2duBXp1tfh2RXo1accZbk1VE61q9ppYkAtNjpf81cd` (`python3 scripts/mempool-id.py docs/VPR.md`).

The rule runs in our fork of the alt-mempool sidecar (`sidecar/`). It needs ethrex to report the gas
of each call in its trace ([martonp/ethrex](https://github.com/martonp/ethrex), branch
`vpr-call-gas`); until that is deployed, the sidecar substitutes measured costs.

## Repository

| Path | |
|---|---|
| `contracts/` | Foundry: verifiers, `AgileWallet`, factory, deploy script |
| `extension/` | Chrome MV3 extension (React, Vite); see its README |
| `sidecar/` | Alt-mempool sidecar fork with the VPR rule |
| `scripts/` | Devnet scripts: verifier gas measurement, end-to-end transaction, mempool ID |
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
```

## Status

- On a local devnet, a SPHINCS- wallet's first transaction (deploy and transfer) and a second
  transfer were admitted through VPR and mined. The canonical mempool would reject both. With two
  VPR nodes peered, a transaction sent to one was gossiped on the VPR topic to the other.
- Wallets with Falcon don't fit yet: work outside the verifiers (deployment, the wallet's own
  checks) must stay under 100,000 gas, and with Falcon's 1 KB key it comes to about 111,000.
- The extension creates, stores and unlocks the wallet and signs with ECDSA and Falcon; it does
  not send transactions yet.
- The sidecar matches verifiers by their configured addresses; it does not yet check code hashes
  or function selectors, and its base rules are the standard alt-mempool's rather than exactly the
  canonical mempool's.
- falcon.js never seeds its signing randomness, a known prototype limitation.
- The cryptography (ZKNOX Falcon, SPHINCS-, falcon.js) is research code and unaudited. Don't use
  this with real funds.

How AI was used: [`AI_USAGE.md`](AI_USAGE.md).
