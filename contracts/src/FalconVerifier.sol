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
