import { bytesToHex } from "@noble/hashes/utils.js";
import { type Hex, concat, encodeAbiParameters, getContractAddress, keccak256, pad, toFunctionSelector } from "viem";
import { type SigningKeys, deriveSigningKeys, wipeKeys } from "./derive";
import { ecdsaAddress } from "./ecdsa";
import { falconPublicKey } from "./falcon";
import { CONTRACTS, type Network, VERIFIERS } from "./network";
import { rpc } from "./rpc";
import { SCHEMES, type Scheme } from "./schemes";
import { sphincsPublicKey } from "./sphincs";

// What the extension keeps in the clear: nothing here is secret. The verifiers' addresses are in VERIFIERS.
export interface Account {
  owner: string; // the ECDSA address that authorises the wallet's deployment, and fixes its address
  schemes: { scheme: Scheme; publicKey: string }[]; // in SCHEMES order; ECDSA's public key is its address
}

const KEY = "account";
const PENDING_KEY = "pendingSchemes";

// The account of `seed` with the chosen schemes. The owner is always the ECDSA key, whether or not ECDSA is one of
// the schemes.
export async function deriveAccount(seed: Uint8Array, schemes: Scheme[]): Promise<Account> {
  const chosen = SCHEMES.filter((s) => schemes.includes(s));
  if (chosen.length === 0) throw new Error("Choose at least one scheme");
  const keys = deriveSigningKeys(seed, ["ecdsa", ...chosen]);
  try {
    const out: Account["schemes"] = [];
    for (const scheme of chosen) out.push({ scheme, publicKey: await publicKeyOf(scheme, keys) });
    return { owner: await publicKeyOf("ecdsa", keys), schemes: out };
  } finally {
    wipeKeys(keys);
  }
}

// A scheme's public key, as its verifier takes it, from its signing key: for ECDSA, the address.
export async function publicKeyOf(scheme: Scheme, keys: SigningKeys): Promise<string> {
  if (scheme === "ecdsa") return hex(ecdsaAddress(keys.ecdsa!));
  return hex(scheme === "falcon" ? await falconPublicKey(keys.falcon!) : await sphincsPublicKey(keys.sphincs!));
}

export async function saveAccount(account: Account): Promise<void> {
  await chrome.storage.local.set({ [KEY]: account });
}

export async function loadAccount(): Promise<Account | undefined> {
  return (await chrome.storage.local.get(KEY))[KEY] as Account | undefined;
}

const SCHEMES_HASH = toFunctionSelector("schemesHash()");

// keccak256(abi.encode(Scheme[])): what AgileWallet stores for its scheme list.
export function schemesHash(schemes: Account["schemes"]): string {
  const encoded = encodeAbiParameters(
    [{ type: "tuple[]", components: [{ name: "verifier", type: "address" }, { name: "publicKey", type: "bytes" }] }],
    [schemes.map((s) => ({ verifier: VERIFIERS[s.scheme] as Hex, publicKey: s.publicKey as Hex }))],
  );
  return keccak256(encoded);
}

async function onchainSchemesHash(network: Network, address: string): Promise<string> {
  return rpc<string>(network.rpcUrl, "eth_call", [{ to: address, data: SCHEMES_HASH }, "latest"]);
}

// A scheme change that was sent but may not be mined yet.
export async function savePendingSchemes(schemes: Account["schemes"]): Promise<void> {
  await chrome.storage.local.set({ [PENDING_KEY]: schemes });
}

export async function clearPendingSchemes(): Promise<void> {
  await chrome.storage.local.set({ [PENDING_KEY]: null });
}

// The stored account, after adopting a pending scheme change the chain now has. A change is only saved once mined,
// and a popup's code stops when it closes, so a change mined after its popup closed is caught up here.
export async function syncAccount(network: Network): Promise<Account | undefined> {
  const account = await loadAccount();
  const pending = (await chrome.storage.local.get(PENDING_KEY))[PENDING_KEY] as Account["schemes"] | null | undefined;
  if (!account || !pending) return account;
  const onchain = await onchainSchemesHash(network, walletAddress(account.owner));
  if (onchain !== schemesHash(pending)) return account; // not mined (yet), or it failed
  const updated = { owner: account.owner, schemes: pending };
  await saveAccount(updated);
  await clearPendingSchemes();
  return updated;
}

// The ERC-1167 proxy that AgileWalletFactory deploys for every wallet.
const PROXY_CODE = concat([
  "0x3d602d80600a3d3981f3363d3d373d3d3d363d73",
  CONTRACTS.implementation as Hex,
  "0x5af43d82803e903d91602b57fd5bf3",
]);

// AgileWalletFactory.walletAddress(owner), computed here rather than asked of the node, so a lying RPC can't hand
// out someone else's address: CREATE2 by the factory, salted with the owner, of the proxy code.
export function walletAddress(owner: string): string {
  return getContractAddress({ opcode: "CREATE2", from: CONTRACTS.factory as Hex, salt: pad(owner as Hex), bytecode: PROXY_CODE });
}

export interface AccountState {
  address: string;
  balance: bigint; // wei
  deployed: boolean;
  schemesMatch: boolean; // the stored schemes are the wallet's on chain (always, before deployment)
}

export async function accountState(network: Network, account: Account): Promise<AccountState> {
  const address = walletAddress(account.owner);
  const [balance, code] = await Promise.all([
    rpc<string>(network.rpcUrl, "eth_getBalance", [address, "latest"]),
    rpc<string>(network.rpcUrl, "eth_getCode", [address, "latest"]),
  ]);
  const deployed = code !== "0x";
  const schemesMatch = !deployed || (await onchainSchemesHash(network, address)) === schemesHash(account.schemes);
  return { address, balance: BigInt(balance), deployed, schemesMatch };
}

// Wei as ETH, with up to `decimals` decimals.
export function formatEth(wei: bigint, decimals = 4): string {
  const scale = 10n ** BigInt(18 - decimals);
  const units = (wei + scale / 2n) / scale; // rounded to `decimals`
  const whole = units / 10n ** BigInt(decimals);
  const fraction = (units % 10n ** BigInt(decimals)).toString().padStart(decimals, "0");
  return `${whole}.${fraction}`;
}

function hex(bytes: Uint8Array): string {
  return `0x${bytesToHex(bytes)}`;
}
