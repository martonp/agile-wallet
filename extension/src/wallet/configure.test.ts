import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type Account, deriveAccount, loadAccount, saveAccount, signalStates } from "./account";
import { createWallet } from "./keyring";
import { entropyToSeed, generateEntropy } from "./mnemonic";
import { CONTRACTS, LOCAL_DEVNET } from "./network";
import { SAFEGUARD_SWITCHED_ON } from "./errors";
import { changeSchemes, sendTransfer } from "./transaction";

// In-memory stand-in for chrome.storage.local, and a node where the wallet is deployed, the signal isn't raised,
// and sending stops with "stop here": these tests are about what gets signed, not what the mempool does.
let sent: unknown[] = [];
let raiseOnSend = false; // the signal is raised as the transaction is sent
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
  sent = [];
  raiseOnSend = false;
  let brokenAt = "0x0";
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const { method, params } = JSON.parse(init.body as string);
    if (method === "eth_sendFrameTransaction") {
      sent.push(params[0]);
      if (raiseOnSend) brokenAt = "0x6b49d200";
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "stop here" } }));
    }
    const result = {
      eth_getBalance: "0xde0b6b3a7640000",
      eth_getCode: "0x60",
      eth_call: brokenAt, // brokenAt (and any hash: the tests don't check them)
      eth_chainId: "0x539",
      eth_getTransactionCount: "0x1",
      eth_getBlockByNumber: { baseFeePerGas: "0x1" },
    }[method as string];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  });
});
afterEach(() => vi.unstubAllGlobals());

const signal = CONTRACTS.ecdsaBreakSignal;

// An ECDSA wallet subscribed with SPHINCS- as the backup, not raised.
async function subscribedWallet(): Promise<Account> {
  const entropy = generateEntropy();
  const account = await createWallet("pw", entropy, ["ecdsa"], null);
  const sphincs = (await deriveAccount(entropyToSeed(entropy), ["sphincs"])).schemes[0];
  const subscribed = { ...account, rules: [{ signal, ...sphincs }] };
  await saveAccount(subscribed);
  return subscribed;
}

test("adding as a scheme the backup of a rule that isn't raised derives and signs with its key", { timeout: 60_000 }, async () => {
  const account = await subscribedWallet();
  await expect(
    changeSchemes("pw", account, { schemes: ["ecdsa", "sphincs"], rules: [{ signal, scheme: "sphincs" }] }),
  ).rejects.toThrow("stop here");
  expect(sent).toHaveLength(1); // signed with ECDSA and SPHINCS-, then sent
  expect((await loadAccount(0))!.schemes.map((s) => s.scheme)).toEqual(["ecdsa"]); // not mined: unchanged
});

test("a change that changes nothing, or names an unknown signal, is refused before anything is sent", { timeout: 60_000 }, async () => {
  const account = await subscribedWallet();
  await expect(changeSchemes("pw", account, { schemes: ["ecdsa"], rules: [{ signal, scheme: "sphincs" }] })).rejects.toThrow(
    "Nothing to change",
  );
  await expect(
    changeSchemes("pw", account, { schemes: ["ecdsa"], rules: [{ signal: "0x" + "12".repeat(20), scheme: "sphincs" }] }),
  ).rejects.toThrow("Unknown break signal");
  expect(sent).toHaveLength(0);
});

test("a signal that isn't deployed on the network reads as not raised", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x" })));
  expect(await signalStates(LOCAL_DEVNET)).toEqual({ [signal.toLowerCase()]: 0 });
});

test("a send refused because the signal was just raised says a safeguard switched on", { timeout: 60_000 }, async () => {
  const account = await subscribedWallet();
  raiseOnSend = true;
  await expect(sendTransfer("pw", account, { to: "0x8943545177806ED17B9F23F0a21ee5948eCaa776", value: 1n })).rejects.toThrow(
    SAFEGUARD_SWITCHED_ON,
  );
});
