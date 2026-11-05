// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IVerifier} from "./IVerifier.sol";
import {falcon_core8} from "ETHFALCON/src/ZKNOX_falcon_core8.sol";

/// Falcon-512 (NIST, SHAKE256 hash-to-point) through ZKNOX's falcon8 verifier.
///
/// Takes the encodings of ZKNOX's own signer (ETHFALCON/falcon/falcon.js) without their header bytes:
/// - `publicKey`: 1024 bytes, NTT(h) as 512 big-endian 16-bit coefficients;
/// - `signature`: 1064 bytes, the 40-byte salt then s2 as 512 big-endian 16-bit coefficients mod q.
/// Packing them into falcon8's 16-coefficients-per-word layout costs some gas here, which keeps the
/// signer to a byte copy.
contract FalconVerifier is IVerifier {
    /// The Keccak-f[1600] helper falcon8 runs SHAKE256 on (ETHFALCON test/f1600_zknox.hex).
    bytes32 public constant F1600_CODEHASH = 0x661c9f13236c0174873874530946d802d0ac54373091f0bdea36ab2e3f409155;

    address public immutable f1600Helper;

    constructor(address helper) {
        require(helper.codehash == F1600_CODEHASH, "bad f1600 helper");
        f1600Helper = helper;
    }

    function verify(bytes calldata publicKey, bytes32 digest, bytes calldata signature)
        external
        view
        returns (bool)
    {
        if (publicKey.length != 1024 || signature.length != 1064) return false;
        return falcon_core8(
            signature[0:40], abi.encodePacked(digest), f1600Helper, _pack(signature[40:]), _pack(publicKey)
        );
    }

    /// 512 big-endian 16-bit coefficients into 32 words; coefficient i sits at bits 16*(i%16) of word i/16.
    function _pack(bytes calldata coefficients) private pure returns (uint256[] memory words) {
        words = new uint256[](32);
        assembly ("memory-safe") {
            for { let i := 0 } lt(i, 512) { i := add(i, 1) } {
                let c := shr(240, calldataload(add(coefficients.offset, mul(2, i))))
                let slot := add(add(words, 0x20), shl(5, shr(4, i)))
                mstore(slot, or(mload(slot), shl(shl(4, and(i, 15)), c)))
            }
        }
    }
}
