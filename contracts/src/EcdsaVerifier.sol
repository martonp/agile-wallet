// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVerifier} from "./IVerifier.sol";

/// secp256k1 ECDSA. `publicKey` is the signer's 20-byte address; `signature` is `r ‖ s ‖ v` (65 bytes,
/// v = 27 or 28) over the raw `digest`, with a low `s`.
contract EcdsaVerifier is IVerifier {
    /// secp256k1n / 2: signatures with a larger `s` are malleable copies and are rejected.
    uint256 private constant HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    function verify(bytes calldata publicKey, bytes32 digest, bytes calldata signature)
        external
        pure
        returns (bool)
    {
        if (publicKey.length != 20 || signature.length != 65) return false;

        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (uint256(s) > HALF_N || (v != 27 && v != 28)) return false;

        address signer = ecrecover(digest, v, r, s);
        return signer != address(0) && signer == address(bytes20(publicKey));
    }
}
