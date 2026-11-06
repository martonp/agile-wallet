import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

// The 20-byte Ethereum address: the wallet's owner, and its native ECDSA scheme's public key.
export function ecdsaAddress(privateKey: Uint8Array): Uint8Array {
  const publicKey = secp256k1.getPublicKey(privateKey, false); // 0x04 ‖ x ‖ y
  return keccak_256(publicKey.subarray(1)).slice(12);
}

// A protocol SECP256K1 signature entry's encoding: yParity (0 or 1) ‖ r ‖ s over the raw digest, low s.
export function ecdsaSign(privateKey: Uint8Array, digest: Uint8Array): Uint8Array {
  return secp256k1.sign(digest, privateKey, { prehash: false, format: "recovered" });
}
