// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HegotaSupport} from "hegota-support/HegotaSupport.sol";
import {Devnet} from "hegota-support/Devnet.sol";
import {Scope, TxParam, FrameParam, FrameMode, SigParam} from "hegota-support/Params.sol";
import {IVerifier} from "./IVerifier.sol";
import {BreakSignal} from "./BreakSignal.sol";

/// An EIP-8141 account that needs a valid signature for every scheme in its list. A scheme is any IVerifier
/// together with one public key, so new signature schemes need no change here, or native ECDSA: verifier
/// address(0) and a 20-byte address, signed with a protocol SECP256K1 entry. The wallet stores only the hash
/// of its list; every transaction carries the list itself.
///
/// The wallet can also subscribe to break signals: a rule says that once its signal is raised (say, "quantum
/// computers break ECDSA"), its backup scheme must sign too. It stores the hash of its rules the same way.
///
/// Deployed once as the implementation; every user gets an ERC-1167 proxy from AgileWalletFactory.
///
/// A transaction from the wallet:
///   frames:     [deploy (first tx only)], VERIFY → validate(schemes, rules), SENDER frames (transfers, setSchemes,
///               setRules)
///   signatures: one entry per required scheme, in order, each over the canonical sig hash: SECP256K1 for
///               native ECDSA, ARBITRARY for the others
contract AgileWallet is HegotaSupport(Devnet.ERC8421_WORKSHOP) {
    struct Scheme {
        IVerifier verifier;
        bytes publicKey;
    }

    /// Once `signal` is raised, `scheme` must also sign.
    struct Rule {
        BreakSignal signal;
        Scheme scheme;
    }

    uint256 private constant ARBITRARY = 0;
    uint256 private constant SECP256K1 = 1;

    address public immutable factory;

    /// keccak256(abi.encode(schemes)) of the wallet's schemes.
    bytes32 public schemesHash;

    /// keccak256(abi.encode(rules)) of the wallet's rules, or 0 when it has none.
    bytes32 public rulesHash;

    event SchemesChanged(Scheme[] schemes);
    event RulesChanged(Rule[] rules);

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

    /// The VERIFY frame. `current` and `rules` must be the wallet's. The required schemes are `current`, then the
    /// backups of rules whose signal is raised, then the ones setSchemes and setRules calls in this transaction
    /// add, in frame order; signature i is for required scheme i. Approves execution and payment when all of them
    /// signed.
    function validate(Scheme[] calldata current, Rule[] calldata rules) external {
        require(keccak256(abi.encode(current)) == schemesHash, "wrong schemes");
        require(_hashRules(rules) == rulesHash, "wrong rules");
        Scheme[] memory required = _withRequested(_withRaised(current, rules));
        require(txparam(TxParam.SIGNATURE_COUNT) >= required.length, "missing signature");
        bytes32 sigHash = bytes32(txparam(TxParam.SIG_HASH));

        for (uint256 i; i < required.length; i++) {
            if (address(required[i].verifier) == address(0)) {
                require(_isSecp256k1By(i, required[i].publicKey), "bad ECDSA signature");
                continue;
            }
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

    /// Replaces the wallet's rules. Only the wallet itself can call it, like setSchemes. Its VERIFY frame has then
    /// required the backups of the raised rules (so a holder of a broken key alone can't drop them) and the backup
    /// of every rule in the new list (so a wrong backup key can't lock the wallet once its signal is raised).
    ///
    /// Validation calls each signal, so a signal must answer, and mempools must list it: a signal they don't list
    /// would get every later transaction rejected.
    function setRules(Rule[] calldata newRules) external {
        require(msg.sender == address(this), "only the wallet");
        for (uint256 i; i < newRules.length; i++) {
            newRules[i].signal.broken(); // reverts if it can't answer
        }
        rulesHash = _hashRules(newRules);
        emit RulesChanged(newRules);
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
            if (_isSecp256k1By(i, abi.encodePacked(signer))) return true;
        }
        return false;
    }

    /// Whether signature entry `i` is a protocol-verified SECP256K1 signature over the canonical sig hash by the
    /// 20-byte address `signer`.
    function _isSecp256k1By(uint256 i, bytes memory signer) private view returns (bool) {
        if (signer.length != 20 || sigparam(i, SigParam.SCHEME) != SECP256K1) return false;
        if (sigparam(i, SigParam.MSG) != 0) return false; // an explicit digest could be any old signature
        return sigparam(i, SigParam.RESOLVED_SIGNER) == uint160(bytes20(signer));
    }

    function _hashRules(Rule[] calldata rules) private pure returns (bytes32) {
        return rules.length == 0 ? bytes32(0) : keccak256(abi.encode(rules));
    }

    /// `current` plus the backups of the rules whose signal is raised.
    function _withRaised(Scheme[] calldata current, Rule[] calldata rules) private view returns (Scheme[] memory) {
        Scheme[] memory backups = new Scheme[](rules.length);
        uint256 n;
        for (uint256 i; i < rules.length; i++) {
            if (rules[i].signal.broken()) backups[n++] = rules[i].scheme;
        }
        assembly ("memory-safe") {
            mstore(backups, n)
        }
        return _union(current, backups);
    }

    /// `current` plus every scheme this transaction's setSchemes and setRules calls on this wallet add, in frame
    /// order.
    function _withRequested(Scheme[] memory current) private view returns (Scheme[] memory required) {
        required = current;
        uint256 frameCount = txparam(TxParam.FRAME_COUNT);
        for (uint256 i; i < frameCount; i++) {
            if (frameparam(i, FrameParam.MODE) != uint256(FrameMode.SENDER)) continue;
            if (frameparam(i, FrameParam.RESOLVED_TARGET) != uint160(address(this))) continue;
            uint256 length = frameparam(i, FrameParam.DATA_LENGTH);
            if (length < 4) continue;
            bytes4 selector = bytes4(framedataload(0, i));
            if (selector == this.setSchemes.selector) {
                required = _union(required, abi.decode(framedatacopy(4, length - 4, i), (Scheme[])));
            } else if (selector == this.setRules.selector) {
                required = _union(required, _backups(abi.decode(framedatacopy(4, length - 4, i), (Rule[]))));
            }
        }
    }

    function _backups(Rule[] memory rules) private pure returns (Scheme[] memory backups) {
        backups = new Scheme[](rules.length);
        for (uint256 i; i < rules.length; i++) {
            backups[i] = rules[i].scheme;
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
