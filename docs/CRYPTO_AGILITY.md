# Crypto-Agility Mempool

Mempool ID: the IPFS CIDv0 of this document.

A transaction is valid if it is valid in the canonical EIP-8141 mempool, with these two changes.

## 1. Virtual precompiles

The validation gas limit is:

```
Σ frame.limits.execution  +  Σ sigCost(s)  ≤  MAX_VERIFY_GAS + credit

credit  =  Σ  max(0, gasUsed(c) − precompileGas(f))
```

summed over every call `c` in the validation prefix whose code hash and selector match a listed
function `f`. `gasUsed(c)` includes the calls `c` makes.

| Function | Runtime code hash | `precompileGas` |
|---|---|---|
| Falcon-512 `verify(bytes,bytes,uint256[],uint256[])` | `0xb2e193cca28bccb0ae2b6e6a1d39d62595a62aca25ca22693e3cc1699b490e90` | 3,000 |
| SPHINCS- C13 `verify(bytes32,bytes32,bytes32,bytes)` | `0xd083f9190c16522c0d034ec20814a995fe3c99bbcb266728b5c967e2293be8b2` | 4,000 |

## 2. Break signals

Validation may read the listed slot of a listed address. Any other access to a listed address
follows the canonical rules.

When a listed slot changes, every pending transaction whose validation read it is validated again.

A slot is listed only if it can change once, from zero to nonzero, and never back.

| Signal | Address | Slot |
|---|---|---|
| Quantum computers break ECDSA | `0x108c7aD6Dd81EA131A761B3Db9F817056D26941c` | `0` |
