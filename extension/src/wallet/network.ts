import { explain } from "./errors";
import { rpc } from "./rpc";
import type { Scheme } from "./schemes";

// Where the wallet reads the chain and sends transactions.
export interface Network {
  rpcUrl: string; // an EIP-8141 node: reads and simulation
  sidecarUrl: string; // a VPR mempool node: sending
}

// The local devnet from the README.
export const LOCAL_DEVNET: Network = {
  rpcUrl: "http://127.0.0.1:8545",
  sidecarUrl: "http://127.0.0.1:14338/rpc",
};

// The wallet's contracts (contracts/deployments/1337.json). They are deployed through the deterministic CREATE2
// proxy, so they have these addresses on every chain they are deployed to; a redeploy changes them with the code.
export const CONTRACTS = {
  factory: "0xEF2A1f2C46BC11d36bCEb07D99F4e358fB11Af95",
  implementation: "0x699cB3B36e172b1C4438e65438F4bf33Ee69966c", // AgileWallet, which every wallet's proxy calls
  falconVerifier: "0xbcceb50D9510790828274Ce346D7013eb747c969",
  sphincsVerifier: "0x24227085c65D630F8D0465037CC8924E3E767A88",
};

// Each scheme's verifier in the wallet's scheme list. ECDSA is native: no verifier contract, a protocol SECP256K1
// signature entry instead.
export const VERIFIERS: Record<Scheme, string> = {
  ecdsa: "0x0000000000000000000000000000000000000000",
  falcon: CONTRACTS.falconVerifier,
  sphincs: CONTRACTS.sphincsVerifier,
};

const KEY = "network";

export async function loadNetwork(): Promise<Network> {
  const stored = (await chrome.storage.local.get(KEY))[KEY] as Partial<Network> | undefined;
  return { rpcUrl: stored?.rpcUrl ?? LOCAL_DEVNET.rpcUrl, sidecarUrl: stored?.sidecarUrl ?? LOCAL_DEVNET.sidecarUrl };
}

export async function saveNetwork(network: Network): Promise<void> {
  const problem = invalidField(network);
  if (problem) throw new Error(problem);
  await chrome.storage.local.set({ [KEY]: network });
}

// The first field that isn't a valid URL, as a message; undefined when both are.
export function invalidField(network: Network): string | undefined {
  for (const field of ["rpcUrl", "sidecarUrl"] as const) {
    if (!/^https?:$/.test(urlOrUndefined(network[field])?.protocol ?? "")) return `${LABELS[field]} isn't an http(s) URL`;
  }
}

export const LABELS: Record<keyof Network, string> = {
  rpcUrl: "Node RPC",
  sidecarUrl: "VPR mempool RPC",
};

// Asks each endpoint for its chain id and checks that the wallet's contracts are deployed; one line per finding.
export async function checkNetwork(network: Network): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  let ok = true;
  const attempt = async (label: string, run: () => Promise<string>) => {
    try {
      lines.push(`${label}: ${await run()}`);
    } catch (e) {
      ok = false;
      lines.push(`${label}: ${explain(e)}`);
    }
  };
  const chainId = (url: string) => rpc<string>(url, "eth_chainId").then((id) => `chain ${BigInt(id)}`);
  await attempt(LABELS.rpcUrl, () => chainId(network.rpcUrl));
  await attempt(LABELS.sidecarUrl, () => chainId(network.sidecarUrl));
  await attempt("Wallet contracts", async () => {
    const code = await rpc<string>(network.rpcUrl, "eth_getCode", [CONTRACTS.factory, "latest"]);
    if (code === "0x") throw new Error("not deployed on this network");
    return "deployed";
  });
  return { ok, lines };
}

// Asks Chrome for access to the endpoints' hosts (the manifest grants localhost). Call it straight from a click
// handler: Chrome only shows the prompt during a user gesture, and resolves true at once for hosts it already has.
export async function requestHostAccess(network: Network): Promise<boolean> {
  if (!globalThis.chrome?.permissions) return true; // the Vite dev server
  return chrome.permissions.request({ origins: originPatterns(network) });
}

// Host permission patterns for the endpoints (any port), for chrome.permissions.
export function originPatterns(network: Network): string[] {
  const patterns = [network.rpcUrl, network.sidecarUrl].map((u) => {
    const url = new URL(u);
    return `${url.protocol}//${url.hostname}/*`;
  });
  return [...new Set(patterns)];
}

function urlOrUndefined(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}
