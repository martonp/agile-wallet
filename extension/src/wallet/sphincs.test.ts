import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { expect, test } from "vitest";
import { SPHINCS_PUBLIC_KEY_BYTES, SPHINCS_SIGNATURE_BYTES, sphincsPublicKey, sphincsSign } from "./sphincs";

const seed = new Uint8Array(32).fill(7);

test("public key matches signer-c13", async () => {
  const pk = await sphincsPublicKey(seed);
  expect(pk).toHaveLength(SPHINCS_PUBLIC_KEY_BYTES);
  // `signer-c13 keygen 07…07`: seed ‖ root.
  expect(bytesToHex(pk)).toBe(
    "c73fd9b9421f7dca1b81383d9beee31400000000000000000000000000000000" +
      "49331d28fd0f9969769af6938b5fff8600000000000000000000000000000000",
  );
});

test("signature matches signer-c13", { timeout: 60_000 }, async () => {
  const sig = await sphincsSign(seed, new Uint8Array(32).fill(0xab));
  expect(sig).toHaveLength(SPHINCS_SIGNATURE_BYTES);
  // sha256 of the hex string `signer-c13 sign-with <keygen 07…07> ab…ab` prints, 0x included.
  expect(bytesToHex(sha256(new TextEncoder().encode(`0x${bytesToHex(sig)}`)))).toBe(
    "cc9a5c7ada5eebe9f0a4c6029fe6d49bb1f94be01a915f4c7a857eeecd5ff8a3",
  );
});
