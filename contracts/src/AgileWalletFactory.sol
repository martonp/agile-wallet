// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AgileWallet} from "./AgileWallet.sol";

/// Creates each user's AgileWallet as an ERC-1167 proxy at an address that depends only on its owner's ECDSA
/// address, whatever schemes the wallet starts with.
///
/// `deploy` is meant for the deploy frame of the wallet's first transaction: it does exactly one CREATE2,
/// which installs code at tx.sender, and only writes the new wallet's storage.
contract AgileWalletFactory {
    AgileWallet public immutable implementation;

    constructor() {
        implementation = new AgileWallet(address(this));
    }

    /// Creates `owner`'s wallet with the schemes `initial`. The wallet accepts them only when `owner` signed the
    /// transaction (see AgileWallet.initialize).
    function deploy(address owner, AgileWallet.Scheme[] calldata initial) external returns (address wallet) {
        bytes memory code = _proxyCode();
        assembly ("memory-safe") {
            wallet := create2(0, add(code, 0x20), mload(code), owner)
        }
        require(wallet != address(0), "deploy failed");
        AgileWallet(payable(wallet)).initialize(owner, initial);
    }

    /// The address of `owner`'s wallet, deployed or not.
    function walletAddress(address owner) external view returns (address) {
        bytes32 salt = bytes32(uint256(uint160(owner)));
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(_proxyCode())));
        return address(uint160(uint256(hash)));
    }

    /// ERC-1167 minimal proxy creation code for `implementation`.
    function _proxyCode() private view returns (bytes memory) {
        return abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", address(implementation), hex"5af43d82803e903d91602b57fd5bf3"
        );
    }
}
