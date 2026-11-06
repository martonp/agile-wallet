import { getProfile } from "@forshtat/hegota-support/profiles";
import * as tx from "@forshtat/hegota-support/tx";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { toFunctionSelector } from "viem";
import { expect, test } from "vitest";
import { deriveAccount } from "./account";
import { deriveSigningKeys } from "./derive";
import { CONTRACTS } from "./network";
import { type Action, type TransferContext, buildTransaction, fixedLimits, maxFee, requiredSchemes, signTransaction } from "./transaction";

const PROFILE = getProfile("ethrex-eip8141-tracer");
const seed = new Uint8Array(64).fill(5);
const transfer: Action = { type: "transfer", to: "0x8943545177806ED17B9F23F0a21ee5948eCaa776", value: 10n ** 15n };
const limits = { deploy: 100_000n, verify: 200_000n };

async function context(schemes: ("ecdsa" | "falcon" | "sphincs")[], deployed: boolean): Promise<TransferContext> {
  const account = await deriveAccount(seed, schemes);
  return { account, wallet: "0x" + "11".repeat(20) as `0x${string}`, deployed, balance: 10n ** 18n, chainId: 1337n, nonce: 0n, maxFeePerGas: 2n * 10n ** 9n, signals: {} };
}

const signal = CONTRACTS.ecdsaBreakSignal;
const raised = { [signal.toLowerCase()]: 1_800_000_000 };
const SET_SCHEMES = toFunctionSelector("setSchemes((address,bytes)[])");
const SET_RULES = toFunctionSelector("setRules((address,(address,bytes))[])");
const VALIDATE = toFunctionSelector("validate((address,bytes)[],(address,(address,bytes))[])");

// An ECDSA wallet whose rule makes SPHINCS- sign once the ECDSA signal is raised.
async function subscribed(deployed = true): Promise<TransferContext> {
  const ctx = await context(["ecdsa"], deployed);
  const sphincs = (await deriveAccount(seed, ["sphincs"])).schemes[0];
  return { ...ctx, account: { ...ctx.account, rules: [{ signal, ...sphincs }] } };
}

test("the first transaction deploys, validates, then transfers", async () => {
  const ctx = await context(["ecdsa", "sphincs"], false);
  const unsigned = buildTransaction(ctx, transfer, limits);
  expect(unsigned.frames.map((f) => f.mode)).toEqual(["DEFAULT", "VERIFY", "SENDER"].map((m) => tx.frameMode(PROFILE, m)));
  expect(unsigned.frames[0].target?.toLowerCase()).toBe(CONTRACTS.factory.toLowerCase());
  expect(unsigned.frames[0].limits.execution).toBe(100_000n);
  expect(unsigned.frames[1].target).toBeNull(); // the wallet itself
  expect(unsigned.frames[1].limits.execution).toBe(200_000n);
  expect(unsigned.frames[2]).toMatchObject({ target: "0x8943545177806ED17B9F23F0a21ee5948eCaa776", value: 10n ** 15n });
  expect(unsigned.fees.maxPriorityFeePerGas).toBe(2_000_000_000n); // a fixed 2 gwei tip
  // ECDSA's entry is SECP256K1 and also authorises the deployment, so no extra owner entry.
  expect(unsigned.signatures.map((s) => s.scheme)).toEqual([tx.sigScheme(PROFILE, "SECP256K1"), tx.sigScheme(PROFILE, "ARBITRARY")]);
});

test("without an ECDSA scheme, the first transaction adds the owner's entry; later ones don't deploy", async () => {
  const first = buildTransaction(await context(["sphincs"], false), transfer, limits);
  expect(first.signatures.map((s) => s.scheme)).toEqual([tx.sigScheme(PROFILE, "ARBITRARY"), tx.sigScheme(PROFILE, "SECP256K1")]);
  const later = buildTransaction(await context(["sphincs"], true), transfer, limits);
  expect(later.frames.map((f) => f.mode)).toEqual(["VERIFY", "SENDER"].map((m) => tx.frameMode(PROFILE, m)));
  expect(later.signatures).toHaveLength(1);
});

test("fixed limits are well above what the devnet measured, and an ECDSA-only wallet fits without credit", async () => {
  // Measured on the local devnet: the lowest limits that simulate on a first transaction, and the gas used once deployed.
  const es = (await context(["ecdsa", "sphincs"], false)).account;
  expect(fixedLimits(es, false, transfer).deploy).toBeGreaterThan(51_630n + 5_000n);
  expect(fixedLimits(es, false, transfer).verify).toBeGreaterThan(133_482n + 20_000n);
  expect(fixedLimits(es, true, transfer)).toEqual({ deploy: 0n, verify: fixedLimits(es, false, transfer).verify });
  expect(fixedLimits(es, true, transfer).verify).toBeGreaterThan(141_197n + 20_000n);

  const all = (await context(["ecdsa", "falcon", "sphincs"], false)).account;
  expect(fixedLimits(all, false, transfer).deploy).toBeGreaterThan(65_980n + 10_000n);
  expect(fixedLimits(all, true, transfer).verify).toBeGreaterThan(814_427n + 50_000n); // an expensive Falcon signature, deployed

  // No verifier call, so no VPR credit: the limits plus the SECP256K1 signature cost (2,900) must stay under 100,000.
  const ecdsa = fixedLimits((await context(["ecdsa"], false)).account, false, transfer);
  expect(ecdsa.deploy + ecdsa.verify + 2_900n).toBeLessThan(100_000n);
});

test("signs each entry over the sig hash; the ECDSA entry recovers to the owner", { timeout: 60_000 }, async () => {
  const ctx = await context(["ecdsa", "sphincs"], false);
  const unsigned = buildTransaction(ctx, transfer, limits);
  const keys = deriveSigningKeys(seed, ["ecdsa", "sphincs"]);
  const signed = await signTransaction(unsigned, ctx.account.schemes, keys);
  const digest = hexToBytes(tx.sigHash(PROFILE, signed).slice(2));
  expect(tx.sigHash(PROFILE, signed)).toBe(tx.sigHash(PROFILE, unsigned)); // signatures aren't part of it

  const ecdsa = hexToBytes(signed.signatures[0].signature.slice(2)); // yParity ‖ r ‖ s
  const publicKey = secp256k1.Point.fromBytes(secp256k1.recoverPublicKey(ecdsa, digest, { prehash: false })).toBytes(false);
  expect(`0x${bytesToHex(keccak_256(publicKey.subarray(1)).slice(12))}`).toBe(ctx.account.owner);
  expect(hexToBytes(signed.signatures[1].signature.slice(2))).toHaveLength(3688);
});

test("a scheme change calls setSchemes on the wallet and needs the added schemes' signatures too", async () => {
  const ctx = await context(["ecdsa", "sphincs"], true);
  const falcon = (await deriveAccount(seed, ["falcon"])).schemes[0];
  const next = [ctx.account.schemes[0], falcon]; // drop SPHINCS-, add Falcon
  const change: Action = { type: "configure", schemes: next, rules: [] };

  // The current schemes, then the added one; the removed one still signs.
  expect(requiredSchemes(ctx.account, change).map((s) => s.scheme)).toEqual(["ecdsa", "sphincs", "falcon"]);
  const unsigned = buildTransaction(ctx, change, fixedLimits(ctx.account, true, change));
  expect(unsigned.frames.map((f) => f.mode)).toEqual(["VERIFY", "SENDER"].map((m) => tx.frameMode(PROFILE, m)));
  expect(unsigned.frames[1].target).toBe(ctx.wallet);
  expect(unsigned.frames[0].data.slice(0, 10)).toBe(VALIDATE);
  expect(unsigned.frames[1].data.slice(0, 10)).toBe(SET_SCHEMES);
  expect(unsigned.frames).toHaveLength(2); // the rules don't change: no setRules frame
  expect(unsigned.signatures.map((s) => s.scheme)).toEqual(
    ["SECP256K1", "ARBITRARY", "ARBITRARY"].map((n) => tx.sigScheme(PROFILE, n)),
  );
  // VERIFY pays for every required signature, Falcon's included.
  expect(fixedLimits(ctx.account, true, change).verify).toBeGreaterThan(fixedLimits(ctx.account, true, transfer).verify + 800_000n);
});

test("the max fee covers what the mempool charged for a first ECDSA + SPHINCS- transfer", async () => {
  // The devnet's mempool said such a transfer would owe 886,245 gas at the max fee per gas.
  const ctx = await context(["ecdsa", "sphincs"], false);
  const fee = maxFee(ctx, transfer);
  expect(fee).toBeGreaterThanOrEqual(886_245n * ctx.maxFeePerGas);
  expect(fee).toBeLessThan(1_000_000n * ctx.maxFeePerGas); // an upper bound, but not a wild one
});

test("the fee of the largest transfer covers any smaller one, so balance - fee is a valid Max", async () => {
  const ctx = await context(["ecdsa", "falcon", "sphincs"], true);
  const largest = maxFee(ctx, { type: "transfer", to: `0x${"ff".repeat(20)}`, value: ctx.balance });
  const max = ctx.balance - largest;
  expect(max + maxFee(ctx, { type: "transfer", to: "0x110e4a7e47bc13b9f2cb9923e17f87b41ed0d9ed", value: max })).toBeLessThanOrEqual(ctx.balance);
});

test("a rule needs nothing until its signal is raised; then its backup signs after the schemes", async () => {
  const ctx = await subscribed();
  expect(requiredSchemes(ctx.account, transfer).map((s) => s.scheme)).toEqual(["ecdsa"]);
  expect(requiredSchemes(ctx.account, transfer, raised).map((s) => s.scheme)).toEqual(["ecdsa", "sphincs"]);

  const unsigned = buildTransaction({ ...ctx, signals: raised }, transfer, limits);
  expect(unsigned.signatures.map((s) => s.scheme)).toEqual(["SECP256K1", "ARBITRARY"].map((n) => tx.sigScheme(PROFILE, n)));
  // VERIFY pays for the signal check, and for SPHINCS- once it is raised.
  const before = fixedLimits(ctx.account, true, transfer).verify;
  expect(before).toBeGreaterThan(fixedLimits((await context(["ecdsa"], true)).account, true, transfer).verify);
  expect(fixedLimits(ctx.account, true, transfer, raised).verify).toBeGreaterThan(before + 100_000n);
});

test("subscribing sends only a setRules frame, and needs the backup's signature", async () => {
  const plain = await context(["ecdsa"], true);
  const rules = (await subscribed()).account.rules!;
  const subscribe: Action = { type: "configure", schemes: plain.account.schemes, rules };
  expect(requiredSchemes(plain.account, subscribe).map((s) => s.scheme)).toEqual(["ecdsa", "sphincs"]);
  const unsigned = buildTransaction(plain, subscribe, fixedLimits(plain.account, true, subscribe));
  expect(unsigned.frames.map((f) => f.data.slice(0, 10))).toEqual([VALIDATE, SET_RULES]);
  expect(unsigned.frames[1].limits.state).toBeGreaterThanOrEqual(200_000n); // stores a slot that was empty
});

test("changing schemes and rules together: setSchemes, then setRules, in the wallet's signature order", async () => {
  const ctx = await subscribed();
  const falcon = (await deriveAccount(seed, ["falcon"])).schemes[0];
  // Raised: SPHINCS- signs; add Falcon as a scheme and drop the rule, so SPHINCS- still signs and Falcon too.
  const change: Action = { type: "configure", schemes: [...ctx.account.schemes, falcon], rules: [] };
  expect(requiredSchemes(ctx.account, change, raised).map((s) => s.scheme)).toEqual(["ecdsa", "sphincs", "falcon"]);
  const unsigned = buildTransaction({ ...ctx, signals: raised }, change, limits);
  expect(unsigned.frames.map((f) => f.data.slice(0, 10))).toEqual([VALIDATE, SET_SCHEMES, SET_RULES]);
});

test("a raised backup that is already a scheme adds no signature", async () => {
  const ctx = await context(["ecdsa", "sphincs"], true);
  const account = { ...ctx.account, rules: [{ signal, ...ctx.account.schemes[1] }] };
  expect(requiredSchemes(account, transfer, raised).map((s) => s.scheme)).toEqual(["ecdsa", "sphincs"]);
});

test("an ECDSA wallet with a rule that isn't raised fits the validation budget without credit", async () => {
  // No verifier call, so no VPR credit: VERIFY plus the SECP256K1 signature cost (2,900) must stay under 100,000.
  const ctx = await subscribed();
  expect(fixedLimits(ctx.account, true, transfer).verify + 2_900n).toBeLessThan(100_000n);
  const unsubscribe: Action = { type: "configure", schemes: ctx.account.schemes, rules: [] };
  expect(fixedLimits(ctx.account, true, unsubscribe).verify + 2_900n).toBeLessThan(100_000n);
});
