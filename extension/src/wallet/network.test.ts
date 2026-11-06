import { afterEach, beforeEach, expect, test, vi } from "vitest";
import deployment from "../../../contracts/deployments/1337.json";
import { CONTRACTS, LOCAL_DEVNET, checkNetwork, explorerLink, invalidField, loadNetwork, originPatterns, saveNetwork } from "./network";

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

test("the contracts are the devnet deployment's", () => {
  expect(CONTRACTS.factory).toBe(deployment.factory);
  expect(CONTRACTS.implementation).toBe(deployment.implementation);
  expect(CONTRACTS.falconVerifier).toBe(deployment.falconVerifier);
  expect(CONTRACTS.sphincsVerifier).toBe(deployment.sphincsVerifier);
  expect(CONTRACTS.ecdsaBreakSignal).toBe(deployment.ecdsaBreakSignal);
});

test("loads the defaults until a network is saved", async () => {
  expect(await loadNetwork()).toEqual(LOCAL_DEVNET);
  const custom = { url: "https://mempool.example.org/rpc", explorer: "" }; // no explorer
  await saveNetwork(custom);
  expect(await loadNetwork()).toEqual(custom);
});

test("settings from before, with a node URL too, keep the mempool URL", async () => {
  await (globalThis as any).chrome.storage.local.set({
    network: { rpcUrl: "http://127.0.0.1:8545", sidecarUrl: "http://127.0.0.1:14340/rpc" },
  });
  expect(await loadNetwork()).toEqual({ url: "http://127.0.0.1:14340/rpc", explorer: LOCAL_DEVNET.explorer });
});

test("rejects URLs that aren't", async () => {
  expect(invalidField(LOCAL_DEVNET)).toBeUndefined();
  expect(invalidField({ url: "127.0.0.1:14338" })).toBe("Crypto-Agility Mempool RPC isn't an http(s) URL");
  await expect(saveNetwork({ url: "ftp://x" })).rejects.toThrow("Crypto-Agility Mempool RPC");
  expect(invalidField({ ...LOCAL_DEVNET, explorer: "localhost:5182" })).toBe("Explorer isn't an http(s) URL");
  expect(invalidField({ ...LOCAL_DEVNET, explorer: "" })).toBeUndefined();
});

test("the origin pattern covers the node's host on any port", () => {
  expect(originPatterns(LOCAL_DEVNET)).toEqual(["http://127.0.0.1/*"]);
  expect(originPatterns({ url: "https://mempool.example.org:8443/rpc" })).toEqual(["https://mempool.example.org/*"]);
});

test("the connection check says when the mempool node doesn't forward node reads", async () => {
  const node = (forwards: boolean) =>
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const { method } = JSON.parse(init.body as string);
      const reply =
        method === "eth_chainId"
          ? { result: "0x539" }
          : forwards
            ? { result: method === "eth_blockNumber" ? "0x10" : "0x60" }
            : { error: { message: `Method ${method} is not supported` } };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, ...reply }));
    });
  node(true);
  expect(await checkNetwork(LOCAL_DEVNET)).toEqual({
    ok: true,
    lines: ["Crypto-Agility Mempool RPC: chain 1337", "Node reads: forwarded, block 16", "Wallet contracts: deployed"],
  });
  node(false);
  const { ok, lines } = await checkNetwork(LOCAL_DEVNET);
  expect(ok).toBe(false);
  expect(lines).toEqual(["Crypto-Agility Mempool RPC: chain 1337", "Node reads: not forwarded: the mempool node needs --redirectRpc"]);
});

test("the connection check reports a node that can't be reached as such", async () => {
  vi.stubGlobal("fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  const { ok, lines } = await checkNetwork(LOCAL_DEVNET);
  expect(ok).toBe(false);
  expect(lines).toEqual(["Crypto-Agility Mempool RPC: Can't reach 127.0.0.1:14338", "Node reads: Can't reach 127.0.0.1:14338"]);
});

test("explorer links open the transaction as the wallet's mempool node saw it", () => {
  const hash = `0x${"ab".repeat(32)}`;
  expect(explorerLink({ url: "http://127.0.0.1:14340/rpc", explorer: "http://localhost:5182/" }, hash)).toBe(
    `http://localhost:5182/tx/${hash}?node=http%3A%2F%2F127.0.0.1%3A14340%2Frpc`,
  );
  expect(explorerLink({ url: "http://127.0.0.1:14340/rpc", explorer: "" }, hash)).toBeUndefined();
});
