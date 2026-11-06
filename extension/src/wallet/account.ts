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
  index: number; // the account level of every key's derivation (README.md, "One seed, many keys")
  name: string;
  owner: string; // the ECDSA address that authorises the wallet's deployment, and fixes its address
  schemes: { scheme: Scheme; publicKey: string }[]; // in SCHEMES order; ECDSA's public key is its address
}

// Each account under its own key, so a write to one never touches another: account 0 at "account", then
// "account:1", "account:2", ... The index is the key, not a stored field.
const keyOf = (base: string, index: number) => (index === 0 ? base : `${base}:${index}`);
const COUNT_KEY = "accountCount";
const SELECTED_KEY = "selectedAccount";

// Account `index` of `seed`, with the chosen schemes, or, if its wallet is already on chain, with the schemes the
// wallet has. The owner is always the ECDSA key, whether or not ECDSA is one of the schemes.
export async function deriveAccount(
  seed: Uint8Array,
  schemes: Scheme[],
  index = 0,
  name = `Account ${index + 1}`,
  network?: Network,
): Promise<Account> {
  const keys = deriveSigningKeys(seed, SCHEMES, index); // all of them: any could be on chain
  try {
    const all: Account["schemes"] = [];
    for (const scheme of SCHEMES) all.push({ scheme, publicKey: await publicKeyOf(scheme, keys) });
    const owner = all.find((s) => s.scheme === "ecdsa")!.publicKey;
    const onchain = network && (await recoverSchemes(network, owner, all).catch(() => undefined));
    const chosen = onchain ?? all.filter((s) => schemes.includes(s.scheme));
    if (chosen.length === 0) throw new Error("Choose at least one scheme");
    return { index, name, owner, schemes: chosen };
  } finally {
    wipeKeys(keys);
  }
}

// A deployed wallet's schemes, from its schemes hash: the one subset of the seed's public keys (in SCHEMES order)
// that hashes to it. Only keys from the seed are tried, so a node can't slip in someone else's; undefined before
// deployment, or if no subset matches.
export async function recoverSchemes(network: Network, owner: string, all: Account["schemes"]): Promise<Account["schemes"] | undefined> {
  const address = walletAddress(owner);
  if ((await rpc<string>(network.rpcUrl, "eth_getCode", [address, "latest"])) === "0x") return undefined;
  const onchain = await onchainSchemesHash(network, address);
  for (let mask = 1; mask < 1 << all.length; mask++) {
    const subset = all.filter((_, i) => mask & (1 << i));
    if (schemesHash(subset) === onchain) return subset;
  }
  return undefined;
}

// A scheme's public key, as its verifier takes it, from its signing key: for ECDSA, the address.
export async function publicKeyOf(scheme: Scheme, keys: SigningKeys): Promise<string> {
  if (scheme === "ecdsa") return hex(ecdsaAddress(keys.ecdsa!));
  return hex(scheme === "falcon" ? await falconPublicKey(keys.falcon!) : await sphincsPublicKey(keys.sphincs!));
}

// Saves the account under its own key, and counts it if it's new. Only adding an account writes the count.
export async function saveAccount(account: Account): Promise<void> {
  const { index, ...stored } = account;
  await chrome.storage.local.set({ [keyOf("account", index)]: stored });
  if (index >= (await accountCount())) await chrome.storage.local.set({ [COUNT_KEY]: index + 1 });
}

export async function loadAccount(index = 0): Promise<Account | undefined> {
  const key = keyOf("account", index);
  const stored = (await chrome.storage.local.get(key))[key] as Omit<Account, "index"> | undefined;
  return stored && { index, ...stored, name: stored.name ?? `Account ${index + 1}` };
}

export async function accountCount(): Promise<number> {
  const count = (await chrome.storage.local.get(COUNT_KEY))[COUNT_KEY] as number | undefined;
  return count ?? ((await loadAccount(0)) ? 1 : 0); // a wallet from before multiple accounts has one
}

export async function listAccounts(): Promise<Account[]> {
  const accounts: Account[] = [];
  const count = await accountCount();
  for (let i = 0; i < count; i++) {
    const account = await loadAccount(i);
    if (account) accounts.push(account);
  }
  return accounts;
}

export async function selectedAccount(): Promise<number> {
  const index = (await chrome.storage.local.get(SELECTED_KEY))[SELECTED_KEY] as number | undefined;
  return index !== undefined && index < (await accountCount()) ? index : 0;
}

export async function selectAccount(index: number): Promise<void> {
  await chrome.storage.local.set({ [SELECTED_KEY]: index });
}

// Removes every account record, pending change and history, the count and the selection: all a wallet keeps
// besides its vault. Matches the keys themselves rather than trusting the count, so nothing of an old wallet survives.
export async function clearAccounts(): Promise<void> {
  const keys = Object.keys(await chrome.storage.local.get(null)).filter(
    (key) => /^(account|pendingSchemes|history)(:\d+)?$/.test(key) || key === COUNT_KEY || key === SELECTED_KEY,
  );
  await chrome.storage.local.remove(keys);
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

// A scheme change that was sent but may not be mined yet, per account.
export async function savePendingSchemes(index: number, schemes: Account["schemes"]): Promise<void> {
  await chrome.storage.local.set({ [keyOf("pendingSchemes", index)]: schemes });
}

export async function clearPendingSchemes(index: number): Promise<void> {
  await chrome.storage.local.set({ [keyOf("pendingSchemes", index)]: null });
}

// The stored account, after adopting a pending scheme change the chain now has. A change is only saved once mined,
// and a popup's code stops when it closes, so a change mined after its popup closed is caught up here.
export async function syncAccount(network: Network, index: number): Promise<Account | undefined> {
  const account = await loadAccount(index);
  const key = keyOf("pendingSchemes", index);
  const pending = (await chrome.storage.local.get(key))[key] as Account["schemes"] | null | undefined;
  if (!account || !pending) return account;
  const onchain = await onchainSchemesHash(network, walletAddress(account.owner));
  if (onchain !== schemesHash(pending)) return account; // not mined (yet), or it failed
  const updated = { ...account, schemes: pending };
  await saveAccount(updated);
  await clearPendingSchemes(index);
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
