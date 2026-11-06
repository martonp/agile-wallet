// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {BreakSignal} from "../src/BreakSignal.sol";

contract BreakSignalTest is Test {
    event Broken();

    address private cryptographer = address(0xC0DE);
    BreakSignal private signal = new BreakSignal(cryptographer, "Quantum computers break ECDSA");

    function test_startsNotBroken() public view {
        assertFalse(signal.broken());
        assertEq(signal.brokenAt(), 0);
        assertEq(signal.cryptographer(), cryptographer);
        assertEq(signal.description(), "Quantum computers break ECDSA");
    }

    function test_theCryptographerRaisesIt() public {
        vm.warp(1_800_000_000);
        vm.expectEmit(address(signal));
        emit Broken();
        vm.prank(cryptographer);
        signal.signalBroken();
        assertTrue(signal.broken());
        assertEq(signal.brokenAt(), 1_800_000_000);
    }

    function test_onlyTheCryptographer() public {
        vm.prank(address(0xBAD));
        vm.expectRevert("not the cryptographer");
        signal.signalBroken();
        assertFalse(signal.broken());
    }

    function test_onlyOnce() public {
        vm.prank(cryptographer);
        signal.signalBroken();
        uint256 at = signal.brokenAt();
        vm.warp(block.timestamp + 1 days);
        vm.prank(cryptographer);
        vm.expectRevert("already broken");
        signal.signalBroken();
        assertEq(signal.brokenAt(), at);
    }

    /// Mempools let wallet validation read slot 0 only: `broken()` must read just that slot, and raising the
    /// signal must write just that slot.
    function test_touchesOnlySlotZero() public {
        bytes32[] memory onlySlotZero = new bytes32[](1);

        vm.record();
        signal.broken();
        (bytes32[] memory reads,) = vm.accesses(address(signal));
        assertEq(reads, onlySlotZero);

        vm.record();
        vm.prank(cryptographer);
        signal.signalBroken();
        (, bytes32[] memory writes) = vm.accesses(address(signal));
        assertEq(writes, onlySlotZero);
        assertEq(uint256(vm.load(address(signal), bytes32(0))), signal.brokenAt());
    }
}
