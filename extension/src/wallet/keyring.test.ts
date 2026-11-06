import { beforeEach, expect, test } from "vitest";
import type { SigningKeys } from "./derive";
import { bytesToHex } from "@noble/hashes/utils.js";
import { listAccounts, loadAccount, selectedAccount } from "./account";
import { ecdsaAddress } from "./ecdsa";
import { addAccount, createWallet, hasWallet, withSigningKeys } from "./keyring";
import { generateEntropy } from "./mnemonic";
import { WrongPasswordError } from "./vault";

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

const zeroed = (keys: SigningKeys) => Object.values(keys).every((k) => k.every((b) => b === 0));

test("creates a wallet and signs with the password", async () => {
  expect(await hasWallet()).toBe(false);
  await createWallet("pw", generateEntropy(), ["ecdsa"]);
  expect(await hasWallet()).toBe(true);

  let seen: SigningKeys = {};
  const result = await withSigningKeys("pw", ["ecdsa", "falcon"], (keys) => {
    expect(Object.keys(keys)).toEqual(["ecdsa", "falcon"]);
    expect(zeroed(keys)).toBe(false);
    seen = keys;
    return "signed";
  });
  expect(result).toBe("signed");
  expect(zeroed(seen)).toBe(true);
});

test("wipes keys when signing throws", async () => {
  await createWallet("pw", generateEntropy(), ["ecdsa"]);
  let seen: SigningKeys = {};
  const failing = withSigningKeys("pw", ["sphincs"], (keys) => {
    seen = keys;
    throw new Error("boom");
  });
  await expect(failing).rejects.toThrow("boom");
  expect(zeroed(seen)).toBe(true);
});

test("rejects a wrong password without calling sign", async () => {
  await createWallet("pw", generateEntropy(), ["ecdsa"]);
  let called = false;
  await expect(withSigningKeys("nope", ["ecdsa"], () => (called = true))).rejects.toBeInstanceOf(WrongPasswordError);
  expect(called).toBe(false);
});

test("adds accounts from the same seed, each with its own keys, and selects the new one", async () => {
  await createWallet("pw", generateEntropy(), ["ecdsa"]);
  const added = await addAccount("pw", "Savings", ["ecdsa"]);
  expect(added).toMatchObject({ index: 1, name: "Savings" });
  expect(await selectedAccount()).toBe(1);
  expect((await listAccounts()).map((a) => a.name)).toEqual(["Account 1", "Savings"]);

  // Signing for account 1 derives account 1's keys: their address is its owner, not account 0's.
  const address = (keys: SigningKeys) => `0x${bytesToHex(ecdsaAddress(keys.ecdsa!))}`;
  expect(await withSigningKeys("pw", ["ecdsa"], address, 1)).toBe(added.owner);
  expect(await withSigningKeys("pw", ["ecdsa"], address, 0)).toBe((await loadAccount(0))!.owner);
  await expect(addAccount("wrong", "Other", ["ecdsa"])).rejects.toThrow(WrongPasswordError);
});
