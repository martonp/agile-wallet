// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {EcdsaVerifier} from "../src/EcdsaVerifier.sol";

contract EcdsaVerifierTest is Test {
    uint256 private constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    EcdsaVerifier private verifier = new EcdsaVerifier();
    uint256 private key = 0xA11CE;
    bytes private publicKey = abi.encodePacked(vm.addr(key));
    bytes32 private digest = keccak256("frame tx sig hash");

    function sign(bytes32 d) private view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, d);
        return abi.encodePacked(r, s, v);
    }

    function test_validSignature() public view {
        assertTrue(verifier.verify(publicKey, digest, sign(digest)));
    }

    function test_wrongDigest() public view {
        assertFalse(verifier.verify(publicKey, keccak256("other"), sign(digest)));
    }

    function test_wrongSigner() public view {
        assertFalse(verifier.verify(abi.encodePacked(vm.addr(key + 1)), digest, sign(digest)));
    }

    function test_highS() public view {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        // (r, n - s, flipped v) recovers the same signer; it must still be rejected.
        bytes memory malleated = abi.encodePacked(r, bytes32(N - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        assertFalse(verifier.verify(publicKey, digest, malleated));
    }

    function test_badLengths() public view {
        bytes memory sig = sign(digest);
        assertFalse(verifier.verify(abi.encodePacked(bytes19(0)), digest, sig));
        assertFalse(verifier.verify(publicKey, digest, abi.encodePacked(sig, uint8(0))));
        assertFalse(verifier.verify(publicKey, digest, ""));
    }

    function test_garbageSignatureReturnsFalse() public view {
        assertFalse(verifier.verify(publicKey, digest, new bytes(65)));
    }
}
