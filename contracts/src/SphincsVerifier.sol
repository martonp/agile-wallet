// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerifier} from "./IVerifier.sol";

/// nconsigny's SPHINCS- C13 verifier (SPHINCS- src/keccak/SPHINCs-C13Asm.sol), deployed on its own.
interface ISphincsC13 {
    function verify(bytes32 pkSeed, bytes32 pkRoot, bytes32 message, bytes calldata sig) external pure returns (bool);
}

/// SPHINCS- C13 (WOTS+C / FORS+C over keccak256): an IVerifier adapter over a deployed SphincsC13Asm.
///
/// Takes the encodings of the repo's own signer (signers/signer-wasm):
/// - `publicKey`: 64 bytes, pkSeed ‖ pkRoot, each a 16-byte value in the top half of a 32-byte word;
/// - `signature`: 3688 bytes.
contract SphincsVerifier is IVerifier {
    ISphincsC13 public immutable sphincs;

    constructor(ISphincsC13 sphincs_) {
        sphincs = sphincs_;
    }

    function verify(bytes calldata publicKey, bytes32 digest, bytes calldata signature)
        external
        view
        returns (bool)
    {
        if (publicKey.length != 64 || signature.length != 3688) return false;
        // SphincsC13Asm reverts on a non-canonical key; that counts as an invalid signature.
        try sphincs.verify(bytes32(publicKey[0:32]), bytes32(publicKey[32:64]), digest, signature) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }
}
