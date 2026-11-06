// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Measurement helper: `debug_traceCall` with `callTracer` on `probe` shows the target's call as a nested frame
/// whose `gasUsed` is the gas the target itself consumed, without the intrinsic and calldata gas of a transaction.
contract GasProbe {
    function probe(address target, bytes calldata data) external view returns (bool ok, bytes memory result) {
        (ok, result) = target.staticcall(data);
    }
}
