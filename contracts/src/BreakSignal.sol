// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// A one-way flag that `description` has happened, e.g. "Quantum computers break ECDSA". Only `cryptographer`
/// can raise it, and nothing can lower it. Wallets subscribe to it: once it is raised, they also require the
/// backup scheme they chose.
///
/// Mempools may let wallet validation read `brokenAt` (slot 0) because it changes at most once, from zero to
/// nonzero, so raising it can invalidate pending transactions at most once. Keep it that way: no setter, no
/// owner change, no proxy, no DELEGATECALL, no SELFDESTRUCT, and `brokenAt` first in storage.
contract BreakSignal {
    /// When it was raised (block timestamp), or 0 while it isn't.
    uint256 public brokenAt;

    address public immutable cryptographer;
    string public description;

    event Broken();

    constructor(address cryptographer_, string memory description_) {
        cryptographer = cryptographer_;
        description = description_;
    }

    /// Whether it has been raised. Wallet validation calls this; it reads only slot 0.
    function broken() external view returns (bool) {
        return brokenAt != 0;
    }

    function signalBroken() external {
        require(msg.sender == cryptographer, "not the cryptographer");
        require(brokenAt == 0, "already broken");
        brokenAt = block.timestamp;
        emit Broken();
    }
}
