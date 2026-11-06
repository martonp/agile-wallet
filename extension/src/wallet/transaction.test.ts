import { getProfile } from "@forshtat/hegota-support/profiles";
import * as tx from "@forshtat/hegota-support/tx";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { expect, test } from "vitest";
import { deriveAccount } from "./account";
import { deriveSigningKeys } from "./derive";
import { CONTRACTS } from "./network";
import { type TransferContext, buildTransfer, fixedLimits, signTransfer } from "./transaction";

const PROFILE = getProfile("ethrex-eip8141-tracer");
const seed = new Uint8Array(64).fill(5);
const transfer = { to: "0x8943545177806ED17B9F23F0a21ee5948eCaa776", value: 10n ** 15n } as const;
const limits = { deploy: 100_000n, verify: 200_000n };

async function context(schemes: ("ecdsa" | "falcon" | "sphincs")[], deployed: boolean): Promise<TransferContext> {
  const account = await deriveAccount(seed, schemes);
  return { account, wallet: "0x" + "11".repeat(20) as `0x${string}`, deployed, chainId: 1337n, nonce: 0n, maxFeePerGas: 2n * 10n ** 9n };
}

test("the first transaction deploys, validates, then transfers", async () => {
  const ctx = await context(["ecdsa", "sphincs"], false);
  const unsigned = buildTransfer(ctx, transfer, limits);
  expect(unsigned.frames.map((f) => f.mode)).toEqual(["DEFAULT", "VERIFY", "SENDER"].map((m) => tx.frameMode(PROFILE, m)));
  expect(unsigned.frames[0].target?.toLowerCase()).toBe(CONTRACTS.factory.toLowerCase());
  expect(unsigned.frames[0].limits.execution).toBe(100_000n);
  expect(unsigned.frames[1].target).toBeNull(); // the wallet itself
  expect(unsigned.frames[1].limits.execution).toBe(200_000n);
  expect(unsigned.frames[2]).toMatchObject({ target: transfer.to, value: transfer.value });
  // ECDSA's entry is SECP256K1 and also authorises the deployment, so no extra owner entry.
  expect(unsigned.signatures.map((s) => s.scheme)).toEqual([tx.sigScheme(PROFILE, "SECP256K1"), tx.sigScheme(PROFILE, "ARBITRARY")]);
});

test("without an ECDSA scheme, the first transaction adds the owner's entry; later ones don't deploy", async () => {
  const first = buildTransfer(await context(["sphincs"], false), transfer, limits);
  expect(first.signatures.map((s) => s.scheme)).toEqual([tx.sigScheme(PROFILE, "ARBITRARY"), tx.sigScheme(PROFILE, "SECP256K1")]);
  const later = buildTransfer(await context(["sphincs"], true), transfer, limits);
  expect(later.frames.map((f) => f.mode)).toEqual(["VERIFY", "SENDER"].map((m) => tx.frameMode(PROFILE, m)));
  expect(later.signatures).toHaveLength(1);
});

test("fixed limits are well above what the devnet measured, and an ECDSA-only wallet fits without credit", async () => {
  // Measured on the local devnet: the lowest limits that simulate on a first transaction, and the gas used once deployed.
  const es = (await context(["ecdsa", "sphincs"], false)).account;
  expect(fixedLimits(es, false).deploy).toBeGreaterThan(51_630n + 5_000n);
  expect(fixedLimits(es, false).verify).toBeGreaterThan(133_482n + 20_000n);
  expect(fixedLimits(es, true)).toEqual({ deploy: 0n, verify: fixedLimits(es, false).verify });
  expect(fixedLimits(es, true).verify).toBeGreaterThan(141_197n + 20_000n);

  const all = (await context(["ecdsa", "falcon", "sphincs"], false)).account;
  expect(fixedLimits(all, false).deploy).toBeGreaterThan(65_980n + 10_000n);
  expect(fixedLimits(all, true).verify).toBeGreaterThan(814_427n + 50_000n); // an expensive Falcon signature, deployed

  // No verifier call, so no VPR credit: the limits plus the SECP256K1 signature cost (2,900) must stay under 100,000.
  const ecdsa = fixedLimits((await context(["ecdsa"], false)).account, false);
  expect(ecdsa.deploy + ecdsa.verify + 2_900n).toBeLessThan(100_000n);
});

test("signs each entry over the sig hash; the ECDSA entry recovers to the owner", { timeout: 60_000 }, async () => {
  const ctx = await context(["ecdsa", "sphincs"], false);
  const unsigned = buildTransfer(ctx, transfer, limits);
  const keys = deriveSigningKeys(seed, ["ecdsa", "sphincs"]);
  const signed = await signTransfer(unsigned, ctx.account, keys);
  const digest = hexToBytes(tx.sigHash(PROFILE, signed).slice(2));
  expect(tx.sigHash(PROFILE, signed)).toBe(tx.sigHash(PROFILE, unsigned)); // signatures aren't part of it

  const ecdsa = hexToBytes(signed.signatures[0].signature.slice(2)); // yParity ‖ r ‖ s
  const publicKey = secp256k1.Point.fromBytes(secp256k1.recoverPublicKey(ecdsa, digest, { prehash: false })).toBytes(false);
  expect(`0x${bytesToHex(keccak_256(publicKey.subarray(1)).slice(12))}`).toBe(ctx.account.owner);
  expect(hexToBytes(signed.signatures[1].signature.slice(2))).toHaveLength(3688);
});
