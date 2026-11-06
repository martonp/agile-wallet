import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { clearAccounts } from "./account";
import { type HistoryEntry, addEntry, loadHistory, settleEntry, signedSinceRaised, syncHistory } from "./history";
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
  signers: ["ecdsa"],
  status: "pending",
});

test("records sends per account, newest first, and settles them from their receipts", async () => {
  await addEntry(0, entry("0xa"));
  await addEntry(0, entry("0xb"));
  await addEntry(1, entry("0xc"));
  expect((await loadHistory(0)).map((e) => e.hash)).toEqual(["0xb", "0xa"]);
  expect((await loadHistory(1)).map((e) => e.hash)).toEqual(["0xc"]);

  // 884,959 gas at 2 gwei.
  await settleEntry(0, "0xa", { blockNumber: "0xe46", gasUsed: "0xd80df", effectiveGasPrice: "0x77359400", frameReceipts: [{ status: "0x1" }] });
  expect((await loadHistory(0))[1]).toMatchObject({ hash: "0xa", status: "mined", block: 3654, fee: (884_959n * 2_000_000_000n).toString() });
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

test("entries from before kept signing times; they load with just the schemes", async () => {
  const old = { ...entry("0xold"), signers: undefined, signatures: [{ scheme: "ecdsa", ms: 1 }, { scheme: "sphincs", ms: 3800 }] };
  await (globalThis as any).chrome.storage.local.set({ history: [old] });
  expect((await loadHistory(0))[0]).toMatchObject({ hash: "0xold", signers: ["ecdsa", "sphincs"] });
  expect((await loadHistory(0))[0]).not.toHaveProperty("signatures");
});

test("fills in the fee of an entry settled before fees were recorded", async () => {
  await addEntry(0, { ...entry("0xold"), status: "mined", block: 4003 });
  vi.stubGlobal("fetch", async () =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { blockNumber: "0xfa3", gasUsed: "0x10", effectiveGasPrice: "0x2", frameReceipts: [{ status: "0x1" }] } })),
  );
  expect((await syncHistory(LOCAL_DEVNET, 0))[0]).toMatchObject({ status: "mined", block: 4003, fee: "32" });
});

test("signedSinceRaised: only a mined transaction the backup signed after the raise counts", () => {
  const raisedAt = 1_000; // block timestamp, seconds
  const deploy = { ...entry("0x1"), time: 900_000, deploys: true, signers: ["ecdsa", "falcon", "sphincs"] as HistoryEntry["signers"], status: "mined" as const };
  expect(signedSinceRaised([deploy], "sphincs", raisedAt)).toBe(false); // set the safeguard before the raise
  const after = { ...entry("0x2"), time: 1_000_500, signers: ["ecdsa", "falcon", "sphincs"] as HistoryEntry["signers"], status: "mined" as const };
  expect(signedSinceRaised([after, deploy], "sphincs", raisedAt)).toBe(true);
  expect(signedSinceRaised([{ ...after, time: 1_000_000 }], "sphincs", raisedAt)).toBe(true); // sent at the raise's timestamp
  for (const status of ["pending", "failed", "dropped"] as const) {
    expect(signedSinceRaised([{ ...after, status }], "sphincs", raisedAt)).toBe(false);
  }
  expect(signedSinceRaised([{ ...after, signers: ["ecdsa"] }], "sphincs", raisedAt)).toBe(false);
});
