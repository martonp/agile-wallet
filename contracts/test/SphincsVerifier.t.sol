// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SphincsVerifier} from "../src/SphincsVerifier.sol";

/// Parity test: signatures from the SPHINCS- C13 signer verify on chain.
/// Needs the signer built once: `cargo build --release --bin signer-c13` in lib/SPHINCS-/signers/signer-wasm.
contract SphincsVerifierTest is Test {
    string private constant SIGNER = "lib/SPHINCS-/signers/signer-wasm/target/release/signer-c13";

    SphincsVerifier private verifier = new SphincsVerifier();

    struct Key {
        bytes32 seed;
        bytes32 skSeed;
        bytes32 root;
    }

    function keygen(bytes32 seedMaterial) private returns (Key memory k) {
        string[] memory cmd = new string[](3);
        cmd[0] = SIGNER;
        cmd[1] = "keygen";
        cmd[2] = vm.toString(seedMaterial);
        string memory json = string(vm.ffi(cmd));
        k = Key(vm.parseJsonBytes32(json, ".seed"), vm.parseJsonBytes32(json, ".sk_seed"), vm.parseJsonBytes32(json, ".root"));
    }

    function sign(Key memory k, bytes32 digest) private returns (bytes memory) {
        string[] memory cmd = new string[](6);
        cmd[0] = SIGNER;
        cmd[1] = "sign-with";
        cmd[2] = vm.toString(k.seed);
        cmd[3] = vm.toString(k.skSeed);
        cmd[4] = vm.toString(k.root);
        cmd[5] = vm.toString(digest);
        return vm.ffi(cmd);
    }

    function publicKey(Key memory k) private pure returns (bytes memory) {
        return abi.encodePacked(k.seed, k.root);
    }

    function test_validSignature() public {
        Key memory k = keygen(keccak256("seed"));
        bytes32 digest = keccak256("frame tx sig hash");
        bytes memory sig = sign(k, digest);
        assertEq(sig.length, 3688);
        uint256 gasBefore = gasleft();
        assertTrue(verifier.verify(publicKey(k), digest, sig));
        emit log_named_uint("sphincs verify gas", gasBefore - gasleft());
    }

    function test_wrongDigest() public {
        Key memory k = keygen(keccak256("seed"));
        assertFalse(verifier.verify(publicKey(k), keccak256("b"), sign(k, keccak256("a"))));
    }

    function test_wrongKey() public {
        bytes32 digest = keccak256("frame tx sig hash");
        bytes memory sig = sign(keygen(keccak256("seed")), digest);
        assertFalse(verifier.verify(publicKey(keygen(keccak256("other seed"))), digest, sig));
    }

    function test_badLengths() public view {
        assertFalse(verifier.verify(new bytes(63), bytes32(0), new bytes(3688)));
        assertFalse(verifier.verify(new bytes(64), bytes32(0), new bytes(3687)));
    }

    function test_nonCanonicalKeyReturnsFalse() public view {
        // low 128 bits of pkSeed set: SphincsC13Asm reverts, the adapter returns false
        assertFalse(verifier.verify(abi.encodePacked(bytes32(uint256(1)), bytes32(0)), bytes32(0), new bytes(3688)));
    }
}
