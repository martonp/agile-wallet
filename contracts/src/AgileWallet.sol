// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HegotaSupport} from "hegota-support/HegotaSupport.sol";
import {Devnet} from "hegota-support/Devnet.sol";
import {Scope, TxParam, FrameParam, FrameMode, SigParam} from "hegota-support/Params.sol";
import {IVerifier} from "./IVerifier.sol";

/// An EIP-8141 account that needs a valid signature for every scheme in its list. A scheme is any IVerifier
/// together with one public key, so new signature schemes need no change here. The wallet stores only the hash
/// of its list; every transaction carries the list itself.
///
/// Deployed once as the implementation; every user gets an ERC-1167 proxy from AgileWalletFactory.
///
/// A transaction from the wallet:
///   frames:     [deploy (first tx only)], VERIFY → validate(schemes), SENDER frames (transfers, setSchemes)
///   signatures: one ARBITRARY entry per required scheme, in order, each over the canonical sig hash
contract AgileWallet is HegotaSupport(Devnet.ERC8421_WORKSHOP) {
    struct Scheme {
        IVerifier verifier;
        bytes publicKey;
    }

    uint256 private constant ARBITRARY = 0;
    uint256 private constant SECP256K1 = 1;

    address public immutable factory;

    /// keccak256(abi.encode(schemes)) of the wallet's schemes.
    bytes32 public schemesHash;

    event SchemesChanged(Scheme[] schemes);

    constructor(address factory_) {
        factory = factory_;
    }

    receive() external payable {}

    /// Called by the factory right after it creates the proxy. The wallet's address commits only to `owner`, so
    /// `owner` must authorise the initial schemes: the transaction must carry a SECP256K1 signature entry whose
    /// signer is `owner` over the canonical sig hash. The protocol verified it before any frame ran.
    function initialize(address owner, Scheme[] calldata initial) external {
        require(msg.sender == factory && schemesHash == 0, "already initialized");
        require(_signedBy(owner), "owner did not sign");
        _setSchemes(initial);
    }

    /// The VERIFY frame. `current` must be the wallet's schemes. The required schemes are `current`, then the ones
    /// a setSchemes call in this transaction adds; signature i is for required scheme i. Approves execution and
    /// payment when all of them signed.
    function validate(Scheme[] calldata current) external {
        require(keccak256(abi.encode(current)) == schemesHash, "wrong schemes");
        Scheme[] memory required = _withRequested(current);
        bytes32 sigHash = bytes32(txparam(TxParam.SIG_HASH));

        for (uint256 i; i < required.length; i++) {
            require(sigparam(i, SigParam.SCHEME) == ARBITRARY, "not an ARBITRARY signature");
            bytes memory sig = sigdatacopy(0, sigparam(i, SigParam.SIGNATURE_LENGTH), i);
            require(required[i].verifier.verify(required[i].publicKey, sigHash, sig), "bad signature");
        }
        approve(Scope.EXECUTION_AND_PAYMENT);
    }

    /// Replaces the wallet's schemes. Only the wallet itself can call it, from a SENDER frame of its own
    /// transaction, whose VERIFY frame has then required signatures for the old and the new schemes.
    function setSchemes(Scheme[] calldata newSchemes) external {
        require(msg.sender == address(this), "only the wallet");
        _setSchemes(newSchemes);
    }

    function _setSchemes(Scheme[] calldata newSchemes) private {
        require(newSchemes.length != 0, "no schemes");
        for (uint256 i; i < newSchemes.length; i++) {
            for (uint256 j; j < i; j++) {
                require(!_equal(newSchemes[i], newSchemes[j]), "duplicate scheme");
            }
        }
        schemesHash = keccak256(abi.encode(newSchemes));
        emit SchemesChanged(newSchemes);
    }

    /// Whether a protocol-verified SECP256K1 entry of this transaction, over its canonical sig hash, is `signer`'s.
    function _signedBy(address signer) private view returns (bool) {
        uint256 count = txparam(TxParam.SIGNATURE_COUNT);
        for (uint256 i; i < count; i++) {
            if (sigparam(i, SigParam.SCHEME) != SECP256K1) continue;
            if (sigparam(i, SigParam.MSG) != 0) continue; // an explicit digest could be any old signature
            if (sigparam(i, SigParam.RESOLVED_SIGNER) == uint160(signer)) return true;
        }
        return false;
    }

    /// `current` plus every scheme this transaction's setSchemes calls on this wallet add.
    function _withRequested(Scheme[] memory current) private view returns (Scheme[] memory required) {
        required = current;
        uint256 frameCount = txparam(TxParam.FRAME_COUNT);
        for (uint256 i; i < frameCount; i++) {
            if (frameparam(i, FrameParam.MODE) != uint256(FrameMode.SENDER)) continue;
            if (frameparam(i, FrameParam.RESOLVED_TARGET) != uint160(address(this))) continue;
            uint256 length = frameparam(i, FrameParam.DATA_LENGTH);
            if (length < 4 || bytes4(framedataload(0, i)) != this.setSchemes.selector) continue;
            Scheme[] memory added = abi.decode(framedatacopy(4, length - 4, i), (Scheme[]));
            required = _union(required, added);
        }
    }

    /// `a` followed by the entries of `b` that are not in it.
    function _union(Scheme[] memory a, Scheme[] memory b) private pure returns (Scheme[] memory u) {
        u = new Scheme[](a.length + b.length);
        uint256 n;
        for (uint256 i; i < a.length; i++) {
            u[n++] = a[i];
        }
        for (uint256 i; i < b.length; i++) {
            bool seen;
            for (uint256 j; j < n && !seen; j++) {
                seen = _equal(u[j], b[i]);
            }
            if (!seen) u[n++] = b[i];
        }
        assembly ("memory-safe") {
            mstore(u, n)
        }
    }

    function _equal(Scheme memory x, Scheme memory y) private pure returns (bool) {
        return x.verifier == y.verifier && keccak256(x.publicKey) == keccak256(y.publicKey);
    }
}
