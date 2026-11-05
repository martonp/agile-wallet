// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {FalconVerifier} from "../src/FalconVerifier.sol";

/// Parity test: signatures from ZKNOX's falcon.js (test/ffi/falcon_sign.cjs) verify on chain.
contract FalconVerifierTest is Test {
    FalconVerifier private verifier;

    function setUp() public {
        bytes memory runtime = vm.parseBytes(vm.readFile("lib/ETHFALCON/test/f1600_zknox.hex"));
        // initcode: copy the runtime that follows these 11 bytes into memory and return it
        bytes memory initCode = abi.encodePacked(hex"61", uint16(runtime.length), hex"8061000b5f395ff3", runtime);
        address helper;
        assembly {
            helper := create(0, add(initCode, 32), mload(initCode))
        }
        verifier = new FalconVerifier(helper);
    }

    /// Returns (publicKey, signature) signed by falcon.js with the key derived from `seed`.
    function sign(bytes32 seed, bytes32 digest) private returns (bytes memory pk, bytes memory sig) {
        string[] memory cmd = new string[](4);
        cmd[0] = "node";
        cmd[1] = "test/ffi/falcon_sign.cjs";
        cmd[2] = vm.toString(seed);
        cmd[3] = vm.toString(digest);
        bytes memory out = vm.ffi(cmd);
        assertEq(out.length, 1024 + 1064);
        pk = new bytes(1024);
        sig = new bytes(1064);
        for (uint256 i; i < 1024; i++) pk[i] = out[i];
        for (uint256 i; i < 1064; i++) sig[i] = out[1024 + i];
    }

    function test_validSignature() public {
        bytes32 digest = keccak256("frame tx sig hash");
        (bytes memory pk, bytes memory sig) = sign(keccak256("seed"), digest);
        uint256 gasBefore = gasleft();
        assertTrue(verifier.verify(pk, digest, sig));
        emit log_named_uint("falcon verify gas", gasBefore - gasleft());
    }

    function test_wrongDigest() public {
        (bytes memory pk, bytes memory sig) = sign(keccak256("seed"), keccak256("a"));
        assertFalse(verifier.verify(pk, keccak256("b"), sig));
    }

    function test_wrongKey() public {
        bytes32 digest = keccak256("frame tx sig hash");
        (, bytes memory sig) = sign(keccak256("seed"), digest);
        (bytes memory otherPk,) = sign(keccak256("other seed"), digest);
        assertFalse(verifier.verify(otherPk, digest, sig));
    }

    function test_badLengths() public {
        bytes32 digest = keccak256("frame tx sig hash");
        (bytes memory pk, bytes memory sig) = sign(keccak256("seed"), digest);
        assertFalse(verifier.verify(new bytes(1023), digest, sig));
        assertFalse(verifier.verify(pk, digest, new bytes(1063)));
    }

    function test_rejectsWrongHelper() public {
        vm.expectRevert("bad f1600 helper");
        new FalconVerifier(address(this));
    }
}
