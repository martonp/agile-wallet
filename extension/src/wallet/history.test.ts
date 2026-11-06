import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { clearAccounts } from "./account";
import { type HistoryEntry, addEntry, loadHistory, settleEntry, syncHistory } from "./history";
import { LOCAL_DEVNET } from "./network";

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
afterEach(() => vi.unstubAllGlobals());

const entry = (hash: string): HistoryEntry => ({
  hash,
  time: 1,
  kind: "transfer",
  to: "0x110e4a7e47bc13b9f2cb9923e17f87b41ed0d9ed",
  value: "1000000000000000",
  deploys: false,
  signatures: [{ scheme: "ecdsa", ms: 1 }],
  status: "pending",
});

test("records sends per account, newest first, and settles them from their receipts", async () => {
  await addEntry(0, entry("0xa"));
  await addEntry(0, entry("0xb"));
  await addEntry(1, entry("0xc"));
  expect((await loadHistory(0)).map((e) => e.hash)).toEqual(["0xb", "0xa"]);
  expect((await loadHistory(1)).map((e) => e.hash)).toEqual(["0xc"]);

  await settleEntry(0, "0xa", true, 3654);
  expect((await loadHistory(0))[1]).toMatchObject({ hash: "0xa", status: "mined", block: 3654 });
});

test("catches up pending entries whose popup closed before they were mined", async () => {
  await addEntry(0, entry("0xmined"));
  await addEntry(0, entry("0xwaiting"));
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const [hash] = JSON.parse(init.body as string).params;
    const result = hash === "0xmined" ? { blockNumber: "0xe46", frameReceipts: [{ status: "0x1" }, { status: "0x0" }] } : null;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  });
  const synced = await syncHistory(LOCAL_DEVNET, 0);
  expect(synced.find((e) => e.hash === "0xmined")).toMatchObject({ status: "failed", block: 3654 }); // a frame failed
  expect(synced.find((e) => e.hash === "0xwaiting")!.status).toBe("pending");
});

test("keeps the newest 50, and goes with the wallet", async () => {
  for (let i = 0; i < 55; i++) await addEntry(0, entry(`0x${i}`));
  const history = await loadHistory(0);
  expect(history).toHaveLength(50);
  expect(history[0].hash).toBe("0x54");
  await clearAccounts();
  expect(await loadHistory(0)).toEqual([]);
});
