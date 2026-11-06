# Virtual Precompile Rule (VPR)

An alternative mempool for EIP-8141 frame transactions. Its mempool ID is the IPFS CIDv0 of this
document.

A transaction is valid in this mempool if it is valid in the canonical EIP-8141 mempool, with one
change to the validation gas limit.

The canonical mempool requires, over the frames of the validation prefix and the transaction's
signatures:

```
Σ frame.limits.execution  +  Σ sigCost(s)  ≤  MAX_VERIFY_GAS
```

This mempool adds a credit for every call to a listed function made during the validation prefix:

```
credit  =  Σ  max(0, gasUsed(c) − precompileGas(f))      over calls c to a listed function f
```

where `gasUsed(c)` is the gas the call used, including the calls it makes, and a call is to a listed
function when the code it executes has a listed code hash and its calldata selects that function.
The rule becomes:

```
Σ frame.limits.execution  +  Σ sigCost(s)  ≤  MAX_VERIFY_GAS + credit
```

## Listed functions

| Function | Contract | Runtime code hash | `precompileGas` |
|---|---|---|---|
| `verify(bytes,bytes,uint256[],uint256[])` | Falcon-512, ZKNOX `falcon8` | `0xb2e193cca28bccb0ae2b6e6a1d39d62595a62aca25ca22693e3cc1699b490e90` | 3,000 |
| `verify(bytes32,bytes32,bytes32,bytes)` | SPHINCS- C13, `SphincsC13Asm` | `0xd083f9190c16522c0d034ec20814a995fe3c99bbcb266728b5c967e2293be8b2` | 4,000 |
