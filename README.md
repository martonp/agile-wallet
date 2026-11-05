# Agile Wallet

A Chrome-extension wallet for an Ethereum smart account that can require any mix of signature
schemes (today ECDSA, Falcon-512 and SPHINCS-) and change that mix over time. Its transactions are
EIP-8141 frame transactions, carried by the **Virtual Precompile Rule (VPR)**: an alternative
mempool in which post-quantum signature checks fit the validation budget, without staking.

## How it works

**Verifiers.** Every scheme has an `IVerifier` adapter in `contracts/src`:

| Scheme | Verifies with |
|---|---|
| ECDSA | `ecrecover` |

## Repository

| Path | |
|---|---|
| `contracts/` | Foundry: verifiers |
| `sidecar/` | Alt-mempool sidecar fork |

How AI was used: [`AI_USAGE.md`](AI_USAGE.md).
