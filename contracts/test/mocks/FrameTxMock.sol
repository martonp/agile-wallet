// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";

/// The test EVM has no EIP-8141 frame opcodes. HegotaSupport calls one helper contract per opcode, created by its
/// constructor in a fixed order (ERC8421_WORKSHOP: Approve at nonce 1, then TxParam, FrameDataLoad, FrameDataCopy,
/// FrameParam, SigParam, SigDataCopy), so tests put MockHelper code at those addresses. The helpers answer from this
/// contract, which holds the frame transaction the test describes.
contract FrameTxMock {
    struct Frame {
        uint256 mode;
        address target;
        bytes data;
    }

    struct Signature {
        uint256 scheme;
        address signer;
        bytes32 msg;
        bytes signature;
    }

    bytes32 public sigHash;
    Frame[] internal _frames;
    Signature[] internal _signatures;

    /// Points `account`'s opcode helpers (it inherits HegotaSupport) at this transaction.
    function install(Vm vm, address account) external {
        for (uint8 kind = 1; kind <= 7; kind++) {
            vm.etch(vm.computeCreateAddress(account, kind), address(new MockHelper(this, kind)).code);
        }
    }

    function reset(bytes32 sigHash_) external {
        sigHash = sigHash_;
        delete _frames;
        delete _signatures;
    }

    function addFrame(uint256 mode, address target, bytes calldata data) external {
        _frames.push(Frame(mode, target, data));
    }

    /// An ARBITRARY (or other unverified) entry: the wallet reads its bytes.
    function addSignature(uint256 scheme, bytes calldata signature) external {
        _signatures.push(Signature(scheme, address(0), 0, signature));
    }

    /// A SECP256K1 entry the protocol has already verified; `digest` 0 is an empty msg: the canonical sig hash.
    function addProtocolSignature(address signer, bytes32 digest) external {
        _signatures.push(Signature(1, signer, digest, ""));
    }

    function txParam(uint256 param) external view returns (uint256) {
        if (param == 8) return uint256(sigHash); // SIG_HASH
        if (param == 9) return _frames.length; // FRAME_COUNT
        if (param == 11) return _signatures.length; // SIGNATURE_COUNT
        revert("txparam not mocked");
    }

    function frameParam(uint256 frameIndex, uint256 param) external view returns (uint256) {
        Frame storage f = _frames[frameIndex];
        if (param == 0) return uint160(f.target); // RESOLVED_TARGET
        if (param == 2) return f.mode; // MODE
        if (param == 4) return f.data.length; // DATA_LENGTH
        revert("frameparam not mocked");
    }

    function frameData(uint256 frameIndex, uint256 offset, uint256 length) external view returns (bytes memory) {
        return _slice(_frames[frameIndex].data, offset, length);
    }

    function sigParam(uint256 sigIndex, uint256 param) external view returns (uint256) {
        Signature storage s = _signatures[sigIndex];
        if (param == 0) {
            // RESOLVED_SIGNER halts for ARBITRARY entries
            require(s.scheme != 0, "ARBITRARY has no signer");
            return uint160(s.signer);
        }
        if (param == 1) return s.scheme; // SCHEME
        if (param == 2) return uint256(s.msg); // MSG
        if (param == 3) return s.signature.length; // SIGNATURE_LENGTH
        revert("sigparam not mocked");
    }

    function sigData(uint256 sigIndex, uint256 offset, uint256 length) external view returns (bytes memory) {
        return _slice(_signatures[sigIndex].signature, offset, length);
    }

    /// CALLDATACOPY semantics: bytes past the end read as zero.
    function _slice(bytes storage data, uint256 offset, uint256 length) private view returns (bytes memory out) {
        out = new bytes(length);
        for (uint256 i; i < length && offset + i < data.length; i++) {
            out[i] = data[offset + i];
        }
    }
}

/// One opcode helper. Takes the operands HegotaSupport sends and returns what the real helper returns.
contract MockHelper {
    event Approved(uint256 scope);

    FrameTxMock internal immutable TX;
    uint8 internal immutable KIND;

    constructor(FrameTxMock tx_, uint8 kind) {
        TX = tx_;
        KIND = kind;
    }

    fallback() external payable {
        bytes memory out;
        if (KIND == 1) {
            // Approve, run by delegatecall: emitted from the account being approved
            emit Approved(abi.decode(msg.data, (uint256)));
            return;
        } else if (KIND == 2) {
            out = abi.encode(TX.txParam(abi.decode(msg.data, (uint256))));
        } else if (KIND == 3) {
            (uint256 offset, uint256 frameIndex) = abi.decode(msg.data, (uint256, uint256));
            out = TX.frameData(frameIndex, offset, 32);
        } else if (KIND == 4) {
            (uint256 offset, uint256 length, uint256 frameIndex) = abi.decode(msg.data, (uint256, uint256, uint256));
            out = TX.frameData(frameIndex, offset, length);
        } else if (KIND == 5) {
            (uint256 frameIndex, uint256 param) = abi.decode(msg.data, (uint256, uint256));
            out = abi.encode(TX.frameParam(frameIndex, param));
        } else if (KIND == 6) {
            (uint256 sigIndex, uint256 param) = abi.decode(msg.data, (uint256, uint256));
            out = abi.encode(TX.sigParam(sigIndex, param));
        } else {
            (uint256 offset, uint256 length, uint256 sigIndex) = abi.decode(msg.data, (uint256, uint256, uint256));
            out = TX.sigData(sigIndex, offset, length);
        }
        assembly {
            return(add(out, 32), mload(out))
        }
    }
}

/// Accepts exactly keccak256(publicKey ‖ digest) as the signature: a stand-in for a post-quantum verifier.
contract MockVerifier {
    function verify(bytes calldata publicKey, bytes32 digest, bytes calldata signature) external pure returns (bool) {
        return keccak256(signature) == keccak256(abi.encodePacked(keccak256(abi.encodePacked(publicKey, digest))));
    }

    function sign(bytes memory publicKey, bytes32 digest) external pure returns (bytes memory) {
        return abi.encodePacked(keccak256(abi.encodePacked(publicKey, digest)));
    }
}
