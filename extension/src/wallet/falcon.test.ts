import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { expect, test } from "vitest";
import createFalcon from "zknox-falcon";
import { FALCON_PUBLIC_KEY_BYTES, FALCON_SIGNATURE_BYTES, falconPublicKey, falconSign } from "./falcon";

const seed = new Uint8Array(48).fill(7);
const digest = new Uint8Array(32).fill(1);

// Verifies with falcon.js's own crypto_sign_open, rebuilding its signed-message layout.
async function verifies(publicKey: Uint8Array, digest: Uint8Array, sig: Uint8Array): Promise<boolean> {
  const f = await createFalcon();
  const sm = new Uint8Array([0x04, 0x01, ...sig.subarray(0, 40), ...digest, 0x29, ...sig.subarray(40)]);
  const put = (b: Uint8Array) => {
    const p = f._malloc(b.length);
    f.HEAPU8.set(b, p);
    return p;
  };
  return f._zknox_crypto_sign_open(f._malloc(sm.length), f._malloc(8), put(sm), BigInt(sm.length), put(new Uint8Array([0x09, ...publicKey]))) === 0;
}

test("public key is deterministic and matches the ffi signer the Solidity tests verify", async () => {
  const pk = await falconPublicKey(seed);
  expect(pk).toHaveLength(FALCON_PUBLIC_KEY_BYTES);
  expect(await falconPublicKey(seed)).toEqual(pk);
  // sha256 of the key `node contracts/test/ffi/falcon_sign.cjs 07…07 01…01` prints.
  expect(bytesToHex(sha256(pk))).toBe("72531b46a091a39a01fb39bde1bcd35390568494adbb19e3818eda463419bc04");
});

test("signatures verify, and not for another digest", async () => {
  const pk = await falconPublicKey(seed);
  const sig = await falconSign(seed, digest);
  expect(sig).toHaveLength(FALCON_SIGNATURE_BYTES);
  expect(await verifies(pk, digest, sig)).toBe(true);
  expect(await verifies(pk, new Uint8Array(32).fill(2), sig)).toBe(false);
});
