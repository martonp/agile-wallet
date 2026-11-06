import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { expect, test } from "vitest";
import { ecdsaAddress, ecdsaSign } from "./ecdsa";

// Hardhat/Foundry's first default account.
const key = hexToBytes("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const HALF_N = secp256k1.Point.CURVE().n / 2n;

// What EcdsaVerifier does: check v and low s, then ecrecover.
function recoverAddress(digest: Uint8Array, sig: Uint8Array): string {
  expect([27, 28]).toContain(sig[64]);
  expect(BigInt("0x" + bytesToHex(sig.subarray(32, 64))) <= HALF_N).toBe(true);
  const recovered = new Uint8Array([sig[64] - 27, ...sig.subarray(0, 64)]);
  const publicKey = secp256k1.recoverPublicKey(recovered, digest, { prehash: false });
  const uncompressed = secp256k1.Point.fromBytes(publicKey).toBytes(false);
  return bytesToHex(keccak_256(uncompressed.subarray(1)).slice(12));
}

test("address of the default Hardhat key", () => {
  expect(bytesToHex(ecdsaAddress(key))).toBe("f39fd6e51aad88f6f4ce6ab8827279cfffb92266");
});

test("signatures recover to the address, with low s and v of 27 or 28", () => {
  for (let i = 0; i < 20; i++) {
    const digest = crypto.getRandomValues(new Uint8Array(32));
    expect(recoverAddress(digest, ecdsaSign(key, digest))).toBe(bytesToHex(ecdsaAddress(key)));
  }
});
