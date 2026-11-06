import { beforeEach, expect, test } from "vitest";
import deployment from "../../../contracts/deployments/1337.json";
import { CONTRACTS, LOCAL_DEVNET, invalidField, loadNetwork, originPatterns, saveNetwork } from "./network";

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

test("the contracts are the devnet deployment's", () => {
  expect(CONTRACTS.factory).toBe(deployment.factory);
  expect(CONTRACTS.implementation).toBe(deployment.implementation);
  expect(CONTRACTS.falconVerifier).toBe(deployment.falconVerifier);
  expect(CONTRACTS.sphincsVerifier).toBe(deployment.sphincsVerifier);
});

test("loads the defaults until a network is saved", async () => {
  expect(await loadNetwork()).toEqual(LOCAL_DEVNET);
  const custom = { ...LOCAL_DEVNET, rpcUrl: "https://rpc.example.org", sidecarUrl: "https://vpr.example.org/rpc" };
  await saveNetwork(custom);
  expect(await loadNetwork()).toEqual(custom);
});

test("rejects URLs that aren't", async () => {
  expect(invalidField(LOCAL_DEVNET)).toBeUndefined();
  expect(invalidField({ ...LOCAL_DEVNET, rpcUrl: "127.0.0.1:8545" })).toBe("Node RPC isn't an http(s) URL");
  await expect(saveNetwork({ ...LOCAL_DEVNET, sidecarUrl: "ftp://x" })).rejects.toThrow("VPR mempool RPC");
});

test("origin patterns cover both endpoints on any port", () => {
  expect(originPatterns(LOCAL_DEVNET)).toEqual(["http://127.0.0.1/*"]);
  expect(originPatterns({ ...LOCAL_DEVNET, sidecarUrl: "https://vpr.example.org:8443/rpc" })).toEqual([
    "http://127.0.0.1/*",
    "https://vpr.example.org/*",
  ]);
});
