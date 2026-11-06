// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";

interface IAgileWalletFactory {
    function implementation() external view returns (address);
}

/// Deploys everything through the deterministic CREATE2 proxy (0x4e59…956c), so the addresses are the same on
/// every chain that has it, and writes them to deployments/<chain id>.json. Skips contracts already deployed.
/// Creation code comes from the build artifacts (run `forge build` first): ZKNOX_falcon8 needs solc 0.8.30 and
/// AgileWallet 0.8.28, so they cannot share this script's compilation unit.
///
///   forge script script/Deploy.s.sol --rpc-url <rpc> --private-key <key> --broadcast --slow --legacy \
///     --gas-estimate-multiplier 900
///
/// The multiplier: from Amsterdam, deployed code costs EIP-8037 state gas (1530 per byte on ethrex), which
/// Foundry's estimate misses. ZKNOX_falcon8 (18.7 KB) needs ~30M, above the 16.7M regular-gas cap; the excess
/// gas limit becomes the state-gas reservoir, so the limit may exceed the cap.
contract Deploy is Script {
    address private constant CREATE2_PROXY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 private constant SALT = bytes32(0);

    function run() external {
        bytes memory f1600 = vm.parseBytes(vm.readFile("lib/ETHFALCON/test/f1600_zknox.hex"));
        // initcode: copy the runtime that follows these 11 bytes into memory and return it
        bytes memory f1600Init = abi.encodePacked(hex"61", uint16(f1600.length), hex"8061000b5f395ff3", f1600);

        vm.startBroadcast();
        // The verifiers themselves, which mempool rules can list, then our IVerifier adapters over them.
        address helper = _deploy(f1600Init);
        address falcon8 = _deploy(abi.encodePacked(vm.getCode("ZKNOX_falcon8.sol:ZKNOX_falcon8"), abi.encode(helper)));
        address sphincsC13 = _deploy(vm.getCode("SPHINCs-C13Asm.sol:SphincsC13Asm"));
        address falcon = _deploy(abi.encodePacked(vm.getCode("FalconVerifier.sol:FalconVerifier"), abi.encode(falcon8)));
        address sphincs = _deploy(abi.encodePacked(vm.getCode("SphincsVerifier.sol:SphincsVerifier"), abi.encode(sphincsC13)));
        address factory = _deploy(vm.getCode("AgileWalletFactory.sol:AgileWalletFactory"));
        vm.stopBroadcast();

        string memory o = "deployment";
        vm.serializeAddress(o, "f1600Helper", helper);
        vm.serializeAddress(o, "falcon8", falcon8);
        vm.serializeAddress(o, "sphincsC13", sphincsC13);
        vm.serializeAddress(o, "falconVerifier", falcon);
        vm.serializeAddress(o, "sphincsVerifier", sphincs);
        vm.serializeAddress(o, "factory", factory);
        string memory json = vm.serializeAddress(o, "implementation", IAgileWalletFactory(factory).implementation());
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), ".json"));
    }

    function _deploy(bytes memory initCode) private returns (address addr) {
        addr = vm.computeCreate2Address(SALT, keccak256(initCode), CREATE2_PROXY);
        if (addr.code.length > 0) return addr;
        (bool ok,) = CREATE2_PROXY.call(abi.encodePacked(SALT, initCode));
        require(ok && addr.code.length > 0, "CREATE2 deploy failed");
    }
}
