import { bytesToHex } from "@noble/hashes/utils.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  accountCount,
  accountState,
  listAccounts,
  recoverRules,
  recoverSchemes,
  renameAccount,
  rulesHash,
  selectAccount,
  selectedAccount,
  deriveAccount,
  formatEth,
  loadAccount,
  saveAccount,
  savePendingSchemes,
  schemesHash,
  syncAccount,
  walletAddress,
} from "./account";
import { deriveSigningKeys } from "./derive";
import { ecdsaAddress } from "./ecdsa";
import { falconPublicKey } from "./falcon";
import { CONTRACTS, LOCAL_DEVNET } from "./network";
import { sphincsPublicKey } from "./sphincs";

const seed = new Uint8Array(64).fill(3);
const hex = (b: Uint8Array) => `0x${bytesToHex(b)}`;

afterEach(() => vi.unstubAllGlobals());

// In-memory stand-in for chrome.storage.local.
beforeEach(() => {
  const store: Record<string, unknown> = {};
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (key: string | null) => (key === null ? { ...store } : key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => Object.assign(store, items),
        remove: async (keys: string[]) => keys.forEach((key) => delete store[key]),
      },
    },
  };
});

const NO_RULES = `0x${"00".repeat(32)}`;
const SELECTORS = { schemesHash: "0x8c8383ac", rulesHash: "0xc76f9c16", brokenAt: "0xb0a5ffde" };

// A node whose wallet is deployed with these hashes, and whose ECDSA break signal was raised at `brokenAt`.
function stubNode(onchain: string, rules = NO_RULES, brokenAt = 0) {
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const { method, params } = JSON.parse(init.body as string);
    const calls: Record<string, string> = {
      [SELECTORS.schemesHash]: onchain,
      [SELECTORS.rulesHash]: rules,
      [SELECTORS.brokenAt]: `0x${brokenAt.toString(16)}`,
    };
    const result = { eth_call: calls[params?.[0]?.data], eth_getBalance: "0x0", eth_getCode: "0x60" }[method as string];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  });
}

test("the owner and each chosen scheme's public key, in scheme order", async () => {
  const keys = deriveSigningKeys(seed, ["ecdsa", "falcon", "sphincs"]);
  const owner = hex(ecdsaAddress(keys.ecdsa!));
  const account = await deriveAccount(seed, ["sphincs", "ecdsa", "falcon"]);
  expect(account).toEqual({
    index: 0,
    name: "Account 1",
    owner,
    schemes: [
      { scheme: "ecdsa", publicKey: owner },
      { scheme: "falcon", publicKey: hex(await falconPublicKey(keys.falcon!)) },
      { scheme: "sphincs", publicKey: hex(await sphincsPublicKey(keys.sphincs!)) },
    ],
  });
});

test("account 1 has its own keys and owner", async () => {
  const account = await deriveAccount(seed, ["ecdsa"], 1, "Savings");
  const keys = deriveSigningKeys(seed, ["ecdsa"], 1);
  expect(account).toMatchObject({ index: 1, name: "Savings", owner: hex(ecdsaAddress(keys.ecdsa!)) });
  expect(account.owner).not.toBe((await deriveAccount(seed, ["ecdsa"])).owner);
});

test("the owner is the ECDSA key even when ECDSA isn't a scheme", async () => {
  const account = await deriveAccount(seed, ["sphincs"]);
  expect(account.owner).toBe((await deriveAccount(seed, ["ecdsa"])).owner);
  expect(account.schemes.map((s) => s.scheme)).toEqual(["sphincs"]);
  await expect(deriveAccount(seed, [])).rejects.toThrow("at least one");
});

test("computes the wallet address as the factory does", () => {
  // AgileWalletFactory.walletAddress(owner) on the local devnet.
  expect(walletAddress("0x788a5af506bcb711abf24cceb18cfc1d77fa07ef")).toBe("0x0342B38C31C0e464F75A29a6E86F688fcCce587a");
  expect(walletAddress("0xcfc10a9dfeed80f9bff8cf8bb1440ad7be963629")).toBe("0x2DE566B69f63533F29E4E219762327E76c36d1d3");
});

test("reads the wallet's balance and code", async () => {
  const results: Record<string, string> = { eth_getBalance: "0xde0b6b3a7640000", eth_getCode: "0x", eth_call: "0x0" }; // 1 ETH, no code
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const { method } = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: results[method] }));
  });
  const owner = "0x788a5af506bcb711abf24cceb18cfc1d77fa07ef";
  const state = await accountState(LOCAL_DEVNET, { index: 0, name: "Account 1", owner, schemes: [] });
  expect(state).toEqual({
    address: walletAddress(owner),
    balance: 10n ** 18n,
    deployed: false,
    schemesMatch: true,
    signals: { [CONTRACTS.ecdsaBreakSignal.toLowerCase()]: 0 }, // not raised
  });
});

test("formats wei as ETH", () => {
  expect(formatEth(10n ** 18n)).toBe("1.0000");
  expect(formatEth(123_456_789_000_000_000n)).toBe("0.1235");
  expect(formatEth(0n)).toBe("0.0000");
});

const ecdsa = { scheme: "ecdsa" as const, publicKey: "0x" + "11".repeat(20) };
const sphincs = { scheme: "sphincs" as const, publicKey: "0xabcd" };

test("the schemes hash is keccak256(abi.encode(Scheme[])), as the wallet stores it", () => {
  // cast keccak $(cast abi-encode "f((address,bytes)[])" "[(0x0…0,0x11…11),(<SPHINCS- verifier>,0xabcd)]")
  expect(schemesHash([ecdsa, sphincs])).toBe("0xaa58868b058d5f563f649b6662b807e2de7ec4ff353e9a2df80610274241ca03");
});

const record = (index: number, schemes: (typeof ecdsa | typeof sphincs)[]) => ({
  index,
  name: `Account ${index + 1}`,
  owner: ecdsa.publicKey,
  schemes,
});

test("syncAccount adopts a pending scheme change once the chain has it, for that account only", async () => {
  await saveAccount(record(0, [ecdsa, sphincs]));
  await saveAccount(record(1, [ecdsa, sphincs]));
  await savePendingSchemes(1, { schemes: [ecdsa], rules: [] });

  stubNode(schemesHash([ecdsa, sphincs])); // not mined yet
  expect((await syncAccount(LOCAL_DEVNET, 1))!.schemes).toEqual([ecdsa, sphincs]);

  stubNode(schemesHash([ecdsa])); // mined after the popup closed
  expect((await syncAccount(LOCAL_DEVNET, 0))!.schemes).toEqual([ecdsa, sphincs]); // no pending change of its own
  expect((await syncAccount(LOCAL_DEVNET, 1))!.schemes).toEqual([ecdsa]);
  expect((await loadAccount(1))!.schemes).toEqual([ecdsa]);
  expect((await loadAccount(0))!.schemes).toEqual([ecdsa, sphincs]);
});

test("accountState says when the stored schemes or rules aren't the wallet's on chain", async () => {
  stubNode(schemesHash([ecdsa]));
  expect((await accountState(LOCAL_DEVNET, record(0, [ecdsa]))).schemesMatch).toBe(true);
  expect((await accountState(LOCAL_DEVNET, record(0, [ecdsa, sphincs]))).schemesMatch).toBe(false);
  expect((await accountState(LOCAL_DEVNET, { ...record(0, [ecdsa]), rules: [rule] })).schemesMatch).toBe(false);
  stubNode(schemesHash([ecdsa]), rulesHash([rule]), 1_800_000_000);
  expect(await accountState(LOCAL_DEVNET, { ...record(0, [ecdsa]), rules: [rule] })).toMatchObject({
    schemesMatch: true,
    signals: { [CONTRACTS.ecdsaBreakSignal.toLowerCase()]: 1_800_000_000 },
  });
});

const rule = { signal: CONTRACTS.ecdsaBreakSignal, ...sphincs };

test("the rules hash is keccak256(abi.encode(Rule[])), or zero for none, as the wallet stores it", () => {
  // cast keccak $(cast abi-encode "f((address,(address,bytes))[])" "[(<signal>,(<SPHINCS- verifier>,0xabcd))]")
  expect(rulesHash([rule])).toBe("0x98bdc749324bda61cb80c029393bfad742b2f2e3831ab7118e83988d7cef311a");
  expect(rulesHash([])).toBe(NO_RULES);
});

test("syncAccount adopts a pending change of schemes and rules, and one saved before rules existed", async () => {
  await saveAccount(record(0, [ecdsa]));
  await savePendingSchemes(0, { schemes: [ecdsa], rules: [rule] });
  stubNode(schemesHash([ecdsa])); // not mined yet
  expect((await syncAccount(LOCAL_DEVNET, 0))!.rules ?? []).toEqual([]);
  stubNode(schemesHash([ecdsa]), rulesHash([rule]));
  expect((await syncAccount(LOCAL_DEVNET, 0))!.rules).toEqual([rule]);

  await (globalThis as any).chrome.storage.local.set({ pendingSchemes: [ecdsa, sphincs] }); // the old format
  stubNode(schemesHash([ecdsa, sphincs]), rulesHash([rule]));
  expect(await syncAccount(LOCAL_DEVNET, 0)).toMatchObject({ schemes: [ecdsa, sphincs], rules: [rule] });
});

test("a deployed wallet's rules are recovered from their hash: none, or one on a known signal with a seed key", async () => {
  const all = [ecdsa, sphincs];
  stubNode(schemesHash([ecdsa]));
  expect(await recoverRules(LOCAL_DEVNET, ecdsa.publicKey, all)).toEqual([]);
  stubNode(schemesHash([ecdsa]), rulesHash([rule]));
  expect(await recoverRules(LOCAL_DEVNET, ecdsa.publicKey, all)).toEqual([rule]);
  stubNode(schemesHash([ecdsa]), rulesHash([{ ...rule, publicKey: "0xbeef" }])); // a key that isn't the seed's
  expect(await recoverRules(LOCAL_DEVNET, ecdsa.publicKey, all)).toBeUndefined();
});

test("each account is stored under its own key; a single-account wallet from before is account 0", async () => {
  (globalThis as any).chrome.storage.local.set({ account: { owner: ecdsa.publicKey, schemes: [ecdsa] } }); // the old format
  expect(await accountCount()).toBe(1);
  expect(await loadAccount(0)).toEqual(record(0, [ecdsa]));

  await saveAccount(record(1, [sphincs]));
  expect(await accountCount()).toBe(2);
  expect((await listAccounts()).map((a) => [a.index, a.name])).toEqual([[0, "Account 1"], [1, "Account 2"]]);
  expect(await selectedAccount()).toBe(0);
  await selectAccount(1);
  expect(await selectedAccount()).toBe(1);
});

test("a deployed wallet's schemes are recovered from its hash, trying only the seed's keys", async () => {
  const all = [ecdsa, { scheme: "falcon" as const, publicKey: "0x1234" }, sphincs];
  stubNode(schemesHash([ecdsa, sphincs]));
  expect(await recoverSchemes(LOCAL_DEVNET, ecdsa.publicKey, all)).toEqual([ecdsa, sphincs]);
  stubNode(schemesHash([{ scheme: "falcon", publicKey: "0xbeef" }])); // a key that isn't the seed's
  expect(await recoverSchemes(LOCAL_DEVNET, ecdsa.publicKey, all)).toBeUndefined();
});

test("an account whose wallet is on chain says its schemes were restored; the flag isn't saved", async () => {
  // Account 0 of `seed`, deployed with ECDSA only.
  const ecdsaOnly = (await deriveAccount(seed, ["ecdsa"])).schemes;
  stubNode(schemesHash(ecdsaOnly));
  const restored = await deriveAccount(seed, ["falcon", "sphincs"], 0, "Account 1", LOCAL_DEVNET);
  expect(restored).toMatchObject({ schemes: ecdsaOnly, restored: true });
  await saveAccount(restored);
  expect(await loadAccount(0)).not.toHaveProperty("restored");
});

test("renames an account, keeping everything else", async () => {
  await saveAccount(record(1, [ecdsa]));
  await renameAccount(1, "  Savings ");
  expect(await loadAccount(1)).toEqual({ ...record(1, [ecdsa]), name: "Savings" });
  await renameAccount(1, "");
  expect((await loadAccount(1))!.name).toBe("Account 2");
});

test("safeguards the deployed wallet doesn't have are dropped, so its transactions validate", async () => {
  await saveAccount({ ...record(0, [ecdsa]), rules: [rule] });
  stubNode(schemesHash([ecdsa]), rulesHash([rule])); // it has them: kept
  expect((await syncAccount(LOCAL_DEVNET, 0))!.rules).toEqual([rule]);
  stubNode(schemesHash([ecdsa])); // deployed without them
  expect((await syncAccount(LOCAL_DEVNET, 0))!.rules).toEqual([]);
  expect((await loadAccount(0))!.rules).toEqual([]);
});
