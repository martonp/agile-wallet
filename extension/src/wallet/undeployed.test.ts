import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { deriveAccount, loadAccount } from "./account";
import { createWallet } from "./keyring";
import { entropyToSeed, generateEntropy } from "./mnemonic";
import { CONTRACTS } from "./network";
import { changeSchemesBeforeDeployment } from "./transaction";
import { WrongPasswordError } from "./vault";

// In-memory stand-in for chrome.storage.local, and a node where the wallet has `code`.
let code = "0x";
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
  code = "0x";
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const { method } = JSON.parse(init.body as string);
    const result = { eth_getCode: code, eth_getBalance: "0x0", eth_call: "0x0" }[method as string]; // eth_call: the signal is not raised
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  });
});
afterEach(() => vi.unstubAllGlobals());

test("before deployment, schemes change without a transaction; adding one derives its key", { timeout: 30_000 }, async () => {
  const entropy = generateEntropy();
  const expected = await deriveAccount(entropyToSeed(entropy), ["ecdsa", "sphincs"]); // computed before the vault zeroes it
  const account = await createWallet("pw", entropy, ["ecdsa"], null);

  const added = await changeSchemesBeforeDeployment("pw", account, { schemes: ["ecdsa", "sphincs"], rules: [] });
  expect(added.schemes).toEqual(expected.schemes);
  expect((await loadAccount(0))!.schemes).toEqual(expected.schemes);

  // Removing needs no keys, so no password.
  const removed = await changeSchemesBeforeDeployment("", added, { schemes: ["sphincs"], rules: [] });
  expect(removed.schemes.map((s) => s.scheme)).toEqual(["sphincs"]);
  await expect(changeSchemesBeforeDeployment("wrong", removed, { schemes: ["ecdsa", "sphincs"], rules: [] })).rejects.toThrow(WrongPasswordError);
});

test("once the wallet is deployed, a change needs a transaction", async () => {
  const account = await createWallet("pw", generateEntropy(), ["ecdsa"], null);
  code = "0x60";
  await expect(changeSchemesBeforeDeployment("pw", account, { schemes: ["ecdsa", "sphincs"], rules: [] })).rejects.toThrow("takes a transaction");
  expect((await loadAccount(0))!.schemes.map((s) => s.scheme)).toEqual(["ecdsa"]);
});

test("before deployment, safeguards are saved too; a backup's key is derived once and then reused", { timeout: 30_000 }, async () => {
  const entropy = generateEntropy();
  const sphincs = (await deriveAccount(entropyToSeed(entropy), ["sphincs"])).schemes[0];
  const account = await createWallet("pw", entropy, ["ecdsa"], null);
  const signal = CONTRACTS.ecdsaBreakSignal;

  const guarded = await changeSchemesBeforeDeployment("pw", account, { schemes: ["ecdsa"], rules: [{ signal, scheme: "sphincs" }] });
  expect(guarded.rules).toEqual([{ signal, ...sphincs }]);
  expect((await loadAccount(0))!.rules).toEqual([{ signal, ...sphincs }]);

  // A backup can't also be a scheme: it would add nothing.
  await expect(
    changeSchemesBeforeDeployment("", guarded, { schemes: ["ecdsa", "sphincs"], rules: [{ signal, scheme: "sphincs" }] }),
  ).rejects.toThrow("is already a required scheme");

  // The backup's key is known now: turning the backup into a scheme needs no password.
  const moved = await changeSchemesBeforeDeployment("", guarded, { schemes: ["ecdsa", "sphincs"], rules: [] });
  expect(moved.schemes).toEqual([account.schemes[0], sphincs]);
  expect(moved.rules).toEqual([]);
});
