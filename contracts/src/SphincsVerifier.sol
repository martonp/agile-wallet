// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IVerifier} from "./IVerifier.sol";
import {SphincsC13Asm} from "SPHINCS-/src/keccak/SPHINCs-C13Asm.sol";

/// SPHINCS- C13 (WOTS+C / FORS+C over keccak256) through nconsigny's SphincsC13Asm.
///
/// Takes the encodings of the repo's own signer (signers/signer-wasm):
/// - `publicKey`: 64 bytes, pkSeed ‖ pkRoot, each a 16-byte value in the top half of a 32-byte word;
/// - `signature`: 3688 bytes.
contract SphincsVerifier is SphincsC13Asm, IVerifier {
    function verify(bytes calldata publicKey, bytes32 digest, bytes calldata signature)
        external
        view
        returns (bool)
    {
        if (publicKey.length != 64 || signature.length != 3688) return false;
        // SphincsC13Asm.verify ends in an assembly `return`, so it can only be called externally.
        // It reverts on a non-canonical key; that counts as an invalid signature.
        try this.verify(bytes32(publicKey[0:32]), bytes32(publicKey[32:64]), digest, signature) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }
}
