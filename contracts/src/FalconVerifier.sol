// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerifier} from "./IVerifier.sol";

/// ZKNOX's falcon8 verifier (ETHFALCON src/ZKNOX_falcon8.sol), deployed on its own.
interface IZknoxFalcon8 {
    function verify(bytes memory h, bytes memory salt, uint256[] memory s2, uint256[] memory ntth)
        external
        view
        returns (bool);
}

/// Falcon-512 (NIST, SHAKE256 hash-to-point): an IVerifier adapter over a deployed ZKNOX falcon8 verifier.
///
/// Takes the encodings of ZKNOX's own signer (ETHFALCON/falcon/falcon.js) without their header bytes:
/// - `publicKey`: 1024 bytes, NTT(h) as 512 big-endian 16-bit coefficients;
/// - `signature`: 1064 bytes, the 40-byte salt then s2 as 512 big-endian 16-bit coefficients mod q.
/// The adapter only packs them into falcon8's 16-coefficients-per-word layout, which keeps the signer to a
/// byte copy. The verification itself runs in the falcon8 contract, so that is what mempool rules can list.
contract FalconVerifier is IVerifier {
    IZknoxFalcon8 public immutable falcon8;

    constructor(IZknoxFalcon8 falcon8_) {
        falcon8 = falcon8_;
    }

    function verify(bytes calldata publicKey, bytes32 digest, bytes calldata signature)
        external
        view
        returns (bool)
    {
        if (publicKey.length != 1024 || signature.length != 1064) return false;
        try falcon8.verify(abi.encodePacked(digest), signature[0:40], _pack(signature[40:]), _pack(publicKey)) returns (
            bool ok
        ) {
            return ok;
        } catch {
            return false;
        }
    }

    /// 512 big-endian 16-bit coefficients into 32 words; coefficient i sits at bits 16*(i%16) of word i/16.
    /// Each 32-byte chunk holds 16 coefficients, first one in the top lane; reversing the order of its 16-bit lanes
    /// (swap halves, then quarters, eighths, sixteenths) puts the first one in the bottom lane.
    function _pack(bytes calldata coefficients) private pure returns (uint256[] memory words) {
        words = new uint256[](32);
        assembly ("memory-safe") {
            let m64 := 0x0000000000000000ffffffffffffffff0000000000000000ffffffffffffffff
            let m32 := 0x00000000ffffffff00000000ffffffff00000000ffffffff00000000ffffffff
            let m16 := 0x0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff
            for { let i := 0 } lt(i, 32) { i := add(i, 1) } {
                let x := calldataload(add(coefficients.offset, shl(5, i)))
                x := or(shr(128, x), shl(128, x))
                x := or(and(shr(64, x), m64), shl(64, and(x, m64)))
                x := or(and(shr(32, x), m32), shl(32, and(x, m32)))
                x := or(and(shr(16, x), m16), shl(16, and(x, m16)))
                mstore(add(add(words, 0x20), shl(5, i)), x)
            }
        }
    }
}
