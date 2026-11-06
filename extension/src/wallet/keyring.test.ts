import { beforeEach, expect, test } from "vitest";
import type { SigningKeys } from "./derive";
import { createWallet, hasWallet, withSigningKeys } from "./keyring";
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
