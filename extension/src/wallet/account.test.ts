import { bytesToHex } from "@noble/hashes/utils.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  accountState,
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
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => Object.assign(store, items),
      },
    },
  };
});

// A node whose wallet (0xab…ab) is deployed with `onchain` as its schemes hash.
function stubNode(onchain: string) {
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const { method, params } = JSON.parse(init.body as string);
    const call = method === "eth_call" && params[0].data === "0x8c8383ac" ? onchain : `0x${"00".repeat(12)}${"ab".repeat(20)}`;
    const result = { eth_call: call, eth_getBalance: "0x0", eth_getCode: "0x60" }[method as string];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  });
}

test("the owner and each chosen scheme's public key, in scheme order", async () => {
  const keys = deriveSigningKeys(seed, ["ecdsa", "falcon", "sphincs"]);
  const owner = hex(ecdsaAddress(keys.ecdsa!));
  const account = await deriveAccount(seed, ["sphincs", "ecdsa", "falcon"]);
  expect(account).toEqual({
    owner,
    schemes: [
      { scheme: "ecdsa", publicKey: owner },
      { scheme: "falcon", publicKey: hex(await falconPublicKey(keys.falcon!)) },
      { scheme: "sphincs", publicKey: hex(await sphincsPublicKey(keys.sphincs!)) },
    ],
  });
});

test("the owner is the ECDSA key even when ECDSA isn't a scheme", async () => {
  const account = await deriveAccount(seed, ["sphincs"]);
  expect(account.owner).toBe((await deriveAccount(seed, ["ecdsa"])).owner);
  expect(account.schemes.map((s) => s.scheme)).toEqual(["sphincs"]);
  await expect(deriveAccount(seed, [])).rejects.toThrow("at least one");
});

test("asks the factory for the wallet address, then reads its balance and code", async () => {
  const calls: { method: string; params: any[] }[] = [];
  const results: Record<string, string> = {
    eth_call: `0x${"00".repeat(12)}${"ab".repeat(20)}`,
    eth_getBalance: "0xde0b6b3a7640000", // 1 ETH
    eth_getCode: "0x",
  };
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const { method, params } = JSON.parse(init.body as string);
    calls.push({ method, params });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: results[method] }));
  });
  const owner = "0x" + "12".repeat(20);
  expect(await walletAddress(LOCAL_DEVNET, owner)).toBe("0x" + "ab".repeat(20));
  // walletAddress(address) selector, then the owner as one word
  expect(calls[0].params[0]).toEqual({ to: CONTRACTS.factory, data: "0x638a88ae" + "12".repeat(20).padStart(64, "0") });

  const state = await accountState(LOCAL_DEVNET, { owner, schemes: [] });
  expect(state).toEqual({ address: "0x" + "ab".repeat(20), balance: 10n ** 18n, deployed: false, schemesMatch: true });
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

test("syncAccount adopts a pending scheme change once the chain has it", async () => {
  await saveAccount({ owner: ecdsa.publicKey, schemes: [ecdsa, sphincs] });
  await savePendingSchemes([ecdsa]);

  stubNode(schemesHash([ecdsa, sphincs])); // not mined yet
  expect((await syncAccount(LOCAL_DEVNET))!.schemes).toEqual([ecdsa, sphincs]);

  stubNode(schemesHash([ecdsa])); // mined after the popup closed
  expect((await syncAccount(LOCAL_DEVNET))!.schemes).toEqual([ecdsa]);
  expect((await loadAccount())!.schemes).toEqual([ecdsa]);
});

test("accountState says when the stored schemes aren't the wallet's on chain", async () => {
  stubNode(schemesHash([ecdsa]));
  expect((await accountState(LOCAL_DEVNET, { owner: ecdsa.publicKey, schemes: [ecdsa] })).schemesMatch).toBe(true);
  expect((await accountState(LOCAL_DEVNET, { owner: ecdsa.publicKey, schemes: [ecdsa, sphincs] })).schemesMatch).toBe(false);
});
