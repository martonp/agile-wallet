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

| Scheme | Verifies with |
|---|---|
| ECDSA | `ecrecover` |
| Falcon-512 | ZKNOX `falcon8` |
| SPHINCS- C13 | nconsigny's `SphincsC13Asm` |

## Repository

| Path | |
|---|---|
| `contracts/` | Foundry: verifiers, `AgileWallet`, factory, deploy script |
| `extension/` | Chrome MV3 extension (React, Vite); see its README |
| `sidecar/` | Alt-mempool sidecar fork |
| `scripts/` | Devnet scripts: verifier gas measurement |

How AI was used: [`AI_USAGE.md`](AI_USAGE.md).
