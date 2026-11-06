import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

// The 20-byte Ethereum address: the wallet's owner, and EcdsaVerifier's public key.
export function ecdsaAddress(privateKey: Uint8Array): Uint8Array {
  const publicKey = secp256k1.getPublicKey(privateKey, false); // 0x04 ‖ x ‖ y
  return keccak_256(publicKey.subarray(1)).slice(12);
}

// The encoding EcdsaVerifier takes: r ‖ s ‖ v (v = 27 or 28) over the raw digest, low s.
export function ecdsaSign(privateKey: Uint8Array, digest: Uint8Array): Uint8Array {
  const recovered = secp256k1.sign(digest, privateKey, { prehash: false, format: "recovered" }); // recovery ‖ r ‖ s
  const sig = new Uint8Array(65);
  sig.set(recovered.subarray(1));
  sig[64] = 27 + recovered[0];
  return sig;
}
