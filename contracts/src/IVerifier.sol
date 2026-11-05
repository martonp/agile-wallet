// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// A stateless signature verifier for one scheme. The wallet calls one per enabled scheme.
interface IVerifier {
    /// True when `signature` is a valid signature of `digest` under `publicKey`.
    /// Never reverts on malformed input; returns false instead. Reads no storage.
    function verify(bytes calldata publicKey, bytes32 digest, bytes calldata signature)
        external
        view
        returns (bool);
}
