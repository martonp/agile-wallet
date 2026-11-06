import { explain } from "./errors";
import { RpcError, rpc } from "./rpc";
import type { Scheme } from "./schemes";

// Where the wallet reads the chain and sends transactions: a Crypto-Agility Mempool node. It takes the transactions,
// and forwards the wallet's reads to its EIP-8141 node (the sidecar's --redirectRpc).
export interface Network {
  url: string;
  explorer?: string; // the sidecar's devnet-ui explorer, for links to transactions; none when empty
}

// The local devnet from the README.
export const LOCAL_DEVNET: Network = {
  url: "http://127.0.0.1:14338/rpc",
  explorer: "http://localhost:5182",
};

// The wallet's contracts (contracts/deployments/1337.json). They are deployed through the deterministic CREATE2
// proxy, so they have these addresses on every chain they are deployed to; a redeploy changes them with the code.
export const CONTRACTS = {
  factory: "0x53c254efc0FD3ADBc2bF47ACbFb681641EcD6B38",
  implementation: "0x29216Ad802a2622Ddb35DBC0eC45DA00223b1c2B", // AgileWallet, which every wallet's proxy calls
  falconVerifier: "0xbcceb50D9510790828274Ce346D7013eb747c969",
  sphincsVerifier: "0x24227085c65D630F8D0465037CC8924E3E767A88",
  ecdsaBreakSignal: "0x108c7aD6Dd81EA131A761B3Db9F817056D26941c",
};

// The break signals a wallet can subscribe to: one-way flags a cryptographer raises when a scheme is broken. Only
// signals the Crypto-Agility Mempool lists, since validation reads them and the mempool rejects reads of any other.
export interface BreakSignal {
  address: string;
  breaks: Scheme;
  label: string;
}

export const SIGNALS: BreakSignal[] = [
  { address: CONTRACTS.ecdsaBreakSignal, breaks: "ecdsa", label: "Quantum computers break ECDSA" },
];

// Each scheme's verifier in the wallet's scheme list. ECDSA is native: no verifier contract, a protocol SECP256K1
// signature entry instead.
export const VERIFIERS: Record<Scheme, string> = {
  ecdsa: "0x0000000000000000000000000000000000000000",
  falcon: CONTRACTS.falconVerifier,
  sphincs: CONTRACTS.sphincsVerifier,
};

const KEY = "network";

// What storage may hold: settings from before kept a node URL as well, and the mempool URL as `sidecarUrl`.
type StoredNetwork = { url?: string; sidecarUrl?: string; explorer?: string };

export async function loadNetwork(): Promise<Network> {
  const stored = (await chrome.storage.local.get(KEY))[KEY] as StoredNetwork | undefined;
  return { url: stored?.url ?? stored?.sidecarUrl ?? LOCAL_DEVNET.url, explorer: stored?.explorer ?? LOCAL_DEVNET.explorer };
}

// A transaction's page in the explorer, as the mempool node the wallet uses saw it; undefined without an explorer.
export function explorerLink(network: Network, hash: string): string | undefined {
  if (!network.explorer) return undefined;
  return `${network.explorer.replace(/\/+$/, "")}/tx/${encodeURIComponent(hash)}?node=${encodeURIComponent(network.url)}`;
}

export async function saveNetwork(network: Network): Promise<void> {
  const problem = invalidField(network);
  if (problem) throw new Error(problem);
  await chrome.storage.local.set({ [KEY]: network });
}

// What's wrong with the URLs, as a message; undefined when the node's is a valid http(s) URL and the explorer's is
// one or empty.
export function invalidField(network: Network): string | undefined {
  const http = (value: string) => /^https?:$/.test(urlOrUndefined(value)?.protocol ?? "");
  if (!http(network.url)) return `${LABEL} isn't an http(s) URL`;
  if (network.explorer && !http(network.explorer)) return `${EXPLORER_LABEL} isn't an http(s) URL`;
}

export const LABEL = "Crypto-Agility Mempool RPC";
export const EXPLORER_LABEL = "Explorer";

// Asks the node for its chain id, checks that it forwards node reads, and that the wallet's contracts are deployed;
// one line per finding.
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
  await attempt(LABEL, () => rpc<string>(network.url, "eth_chainId").then((id) => `chain ${BigInt(id)}`));
  let forwarded = false;
  await attempt("Node reads", async () => {
    const block = await rpc<string>(network.url, "eth_blockNumber").catch((e) => {
      // The sidecar answers methods it doesn't forward with "Method … is not supported".
      if (e instanceof RpcError && /not supported/.test(e.reason)) throw new Error("not forwarded: the mempool node needs --redirectRpc");
      throw e;
    });
    forwarded = true;
    return `forwarded, block ${BigInt(block)}`;
  });
  if (!forwarded) return { ok, lines };
  await attempt("Wallet contracts", async () => {
    const code = await rpc<string>(network.url, "eth_getCode", [CONTRACTS.factory, "latest"]);
    if (code === "0x") throw new Error("not deployed on this network");
    return "deployed";
  });
  return { ok, lines };
}

// Asks Chrome for access to the node's host (the manifest grants localhost). Call it straight from a click
// handler: Chrome only shows the prompt during a user gesture, and resolves true at once for hosts it already has.
export async function requestHostAccess(network: Network): Promise<boolean> {
  if (!globalThis.chrome?.permissions) return true; // the Vite dev server
  return chrome.permissions.request({ origins: originPatterns(network) });
}

// The host permission pattern for the node (any port), for chrome.permissions.
export function originPatterns(network: Network): string[] {
  const url = new URL(network.url);
  return [`${url.protocol}//${url.hostname}/*`];
}

function urlOrUndefined(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}
