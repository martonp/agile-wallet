# Agile Wallet

The crypto-agile wallet: a Chrome extension for Ethereum smart accounts that are secured by several
signature schemes and can switch between them.

- **Per-account signature schemes.** Create multiple accounts from one seed phrase. Each account
  chooses which schemes must sign its transactions (ECDSA, Falcon-512, SPHINCS-, or any mix) and can
  change them later without changing its address.
- **Break-signal safeguards.** An account can subscribe to signals controlled by a trusted party, such
  as a cryptographer. When a signal is triggered ("quantum computers break ECDSA"), the account
  automatically requires an additional signature scheme.

Why: every Ethereum account today relies on one assumption, that ECDSA is hard to break. Quantum
computers will break it, and AI-assisted mathematics may find new attacks on schemes we trust today,
post-quantum ones included. Nobody knows which scheme falls first, or when. So an account should be
secured by several schemes built on different math (elliptic curves, lattices, hash functions), and
moving to a new scheme should be easy.

The wallet's transactions are EIP-8141 frame transactions. They go through the **Crypto-Agility
Mempool**, an alternative mempool I specified and built so that post-quantum signatures and break
signals work without staking.

## How it works

**One seed, many keys.** The extension keeps one 24-word seed phrase and derives every key from it:
ECDSA with BIP-32 (`m/44'/60'/a'/0/i`), Falcon and SPHINCS- from
`HMAC-SHA512(seed, "agile-wallet/<label>/" ‖ a ‖ i)` with the labels `falcon-512` and `sphincs`.
Each account is one `a` (hardened in BIP-32) with `i = 0`, so every account has its own keys and
wallet. Every key comes through a one-way hash, so breaking one scheme exposes only that scheme's key.

**The account.** `AgileWallet` holds a list of schemes, each a verifier contract plus a public key
(or native ECDSA: an address), and stores only the list's hash. A transaction carries the list and
one signature per scheme; the wallet's VERIFY frame checks each signature with its verifier, then
approves the transaction. ECDSA uses the transaction's own SECP256K1 signature, which the protocol
verifies; the wallet only checks its signer.

- Any signature scheme works: adding one means deploying a new verifier, not changing the wallet.
- Changing the list (`setSchemes`) needs signatures from both the old and the new schemes.
- The address depends only on the owner's ECDSA address, so it can be funded before any scheme is
  chosen. The first transaction deploys the wallet with the schemes and safeguards chosen in the
  extension.

**Safeguards.** A safeguard is a rule: a break signal plus a backup scheme. The wallet stores its rules'
hash too. A break signal (`BreakSignal`) is a one-way flag that only its cryptographer can raise. Once
it is raised, the wallet's VERIFY frame also requires the backup's signature, so someone holding only
the broken key can't move funds or remove the safeguard. The extension shows when a subscribed signal
is raised and signs with the backup from then on.

**Verifiers.** Every post-quantum scheme has an `IVerifier` adapter in `contracts/src`. SPHINCS- is an
EVM-optimized variant of SPHINCS+ (SLH-DSA): keccak instead of SHAKE, and a smaller signature budget
per key, for much cheaper verification.

| Scheme | Security rests on | Verifies with | EVM gas per verification |
|---|---|---|---|
| ECDSA | elliptic curves | the protocol (SECP256K1 signature) | none |
| Falcon-512 | lattices | ZKNOX `falcon8` | 590k–635k |
| SPHINCS- C13 | hash functions | nconsigny's `SphincsC13Asm` | 97k |

## The Crypto-Agility Mempool

**The problem.** The canonical EIP-8141 mempool allows only 100,000 gas (`MAX_VERIFY_GAS`) for
validation, and validation can't read any storage outside the sender. One Falcon verification costs
about 600,000 gas, and a wallet has to read its break signals. The standard alternative mempool
allows storage reads with staking, but users shouldn't have to stake to be secure.

The Crypto-Agility Mempool is the canonical mempool with two rules added:

1. **Virtual precompiles.** The rule lists specific verification functions, identified by code hash
   and function selector, each with a precompile price (Falcon 3,000, as EIP-8052 proposes). During
   simulation, the first call to each listed function adds the gas it used minus its precompile price
   to the validation allowance.
   *Safe:* the listed functions are pure, so a valid signature can't be invalidated by other
   transactions, and one credit per function bounds the extra work a transaction can cost a node.
2. **Break-signal reads.** The rule lists specific storage slots that validation may read, with no
   stake. A slot is listed only if it can change once, from zero to a nonzero value.
   *Safe:* each slot can invalidate pending transactions only once, so there is no sustained DoS.

The spec is [`docs/CRYPTO_AGILITY.md`](docs/CRYPTO_AGILITY.md). Its IPFS CIDv0 is the mempool's ID
and gossip topic: `QmPUADe3XwGaPZKHuMJrzKNyzot9jRs2Vs9Ff4m9hbSewA`
(`python3 scripts/mempool-id.py docs/CRYPTO_AGILITY.md`).

The rules run in my fork of the ERC-8421 Mempool Sidecar (`sidecar/`). Crediting each verifier's exact
gas needs ethrex to report the gas of every call in its trace, which my fork adds
([martonp/ethrex](https://github.com/martonp/ethrex), branch `vpr-call-gas`). Until that is
deployed, the sidecar credits a fixed, measured amount instead (see Limitations).

## Repository

| Path | |
|---|---|
| `contracts/` | Foundry: verifiers, `AgileWallet`, factory, `BreakSignal`, deploy script |
| `extension/` | Chrome MV3 extension (React, Vite); see its README |
| `sidecar/` | Alt-mempool sidecar fork with the Crypto-Agility Mempool's rules |
| `scripts/` | Devnet scripts: verifier gas measurement, end-to-end transaction, mempool ID |
| `signal-ui/` | The cryptographer's page for raising a break signal |
| `docs/CRYPTO_AGILITY.md` | The Crypto-Agility Mempool's spec |

## Running the demo

Tested end to end on a local EIP-8141 devnet: wallets with any mix of the three schemes deploy and send
through the Crypto-Agility Mempool (the canonical mempool rejects their transactions), and a raised
break signal makes them require the backup scheme.

Needs an EIP-8141 devnet with the deterministic deployment proxy (for example the alt-mempool
workshop's docker-compose devnet: ethrex, Lighthouse, chain 1337), Foundry, Bun, Node and Cargo.
Each step starts from the repository root.

```bash
# 1. The SPHINCS- signer
(cd contracts/lib/SPHINCS-/signers/signer-wasm && cargo build --release --bin signer-c13)
# 2. Contracts. After the Amsterdam fork, deployed code costs state gas, hence the multiplier of 900. On a
#    fresh chain before that fork, the 16.7M per-transaction gas cap still applies: use 200 instead.
(cd contracts && forge build && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 \
  --private-key $FUNDED_KEY --broadcast --slow --legacy --gas-estimate-multiplier 900)
# 3. The Crypto-Agility sidecar, in its own terminal; it gossips on the mempool's topic
#    (another node joins with --p2p.bootEnrs <the ENR this one logs>). --redirectRpc forwards the wallet's node
#    reads to ethrex, so the extension needs only this node's URL; --explorer.enable serves the explorer.
(cd sidecar && bun install && bun run build && ./skandha node \
  --configFile ../scripts/crypto-agility-sidecar.config.json --api.port 14338 --api.wsPort 14338 \
  --p2p.port 4338 --p2p.enrPort 4338 --redirectRpc --explorer.enable --executor.bundlingMode auto)
# 3b. The mempool explorer, in its own terminal, on the port the extension links to (Settings, Explorer)
(cd sidecar/packages/devnet-ui && \
  VITE_EXPLORER_INSTANCES='[{"name":"Crypto-Agility node","url":"http://127.0.0.1:14338/rpc"}]' \
  bun run dev --port 5182 --strictPort)
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

The extension (see `extension/README.md`) does the same from a browser: set up the schemes and
safeguards, send (the first send deploys the wallet), and follow a raised signal.

## Limitations

- **Stand-in gas credit.** The devnet's ethrex doesn't report per-call gas yet, so the sidecar credits a
  fixed, measured amount to each listed verifier (Falcon 950,000, SPHINCS- 200,000) without checking
  the call did any verification. That is only acceptable on a trusted devnet.
- **Listed by address.** The sidecar matches verifiers by their configured addresses, not yet by code
  hash and selector as the spec says. Falcon's verifier also doesn't check the length of its message
  argument, so the spec should fix every listed function's input sizes.
- **Before deployment, the owner key decides.** The address commits only to the owner's ECDSA key, so
  until the first transaction, that key alone could deploy the wallet with other schemes.
- **Safeguards act once a signal is raised**, and backup keys come from the same seed: they protect
  against a broken algorithm, not a leaked seed phrase.
- **Research code.** The cryptography (ZKNOX Falcon, SPHINCS-, falcon.js) is unaudited, and falcon.js
  never seeds its signing randomness. Don't use this with real funds.

How AI was used: [`AI_USAGE.md`](AI_USAGE.md).
