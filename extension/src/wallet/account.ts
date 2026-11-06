import { bytesToHex } from "@noble/hashes/utils.js";
import { type Hex, concat, encodeAbiParameters, getContractAddress, keccak256, pad, toFunctionSelector } from "viem";
import { type SigningKeys, deriveSigningKeys, wipeKeys } from "./derive";
import { ecdsaAddress } from "./ecdsa";
import { falconPublicKey } from "./falcon";
import { CONTRACTS, type Network, SIGNALS, VERIFIERS } from "./network";
import { rpc } from "./rpc";
import { SCHEMES, type Scheme } from "./schemes";
import { sphincsPublicKey } from "./sphincs";

// What the extension keeps in the clear: nothing here is secret. The verifiers' addresses are in VERIFIERS.
export interface Account {
  index: number; // the account level of every key's derivation (README.md, "One seed, many keys")
  name: string;
  owner: string; // the ECDSA address that authorises the wallet's deployment, and fixes its address
  schemes: { scheme: Scheme; publicKey: string }[]; // in SCHEMES order; ECDSA's public key is its address
  rules?: Rule[]; // break-signal safeguards; missing means none
  restored?: boolean; // set by deriveAccount when the schemes came from the wallet on chain; never saved
}

// A safeguard: once `signal` is raised, `scheme` (with this public key) must also sign.
export interface Rule {
  signal: string;
  scheme: Scheme;
  publicKey: string;
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
    if (onchain) {
      // A node that can't answer fails the restore, rather than saving it with no rules for good. Rules set outside
      // the extension match no candidate: saved as none, and the Account screen says they don't match.
      const rules = await recoverRules(network!, owner, all);
      return { index, name, owner, schemes: onchain, rules: rules ?? [], restored: true };
    }
    const chosen = all.filter((s) => schemes.includes(s.scheme));
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
  if ((await rpc<string>(network.url, "eth_getCode", [address, "latest"])) === "0x") return undefined;
  const onchain = await onchainSchemesHash(network, address);
  for (let mask = 1; mask < 1 << all.length; mask++) {
    const subset = all.filter((_, i) => mask & (1 << i));
    if (schemesHash(subset) === onchain) return subset;
  }
  return undefined;
}

// A deployed wallet's rules, from its rules hash: none, or one rule on a known signal whose backup is one of the
// seed's keys. Undefined if nothing matches.
export async function recoverRules(network: Network, owner: string, all: Account["schemes"]): Promise<Rule[] | undefined> {
  const onchain = await onchainRulesHash(network, walletAddress(owner));
  const candidates: Rule[][] = [[], ...SIGNALS.flatMap((s) => all.map((backup) => [{ signal: s.address, ...backup }]))];
  return candidates.find((rules) => rulesHash(rules) === onchain);
}

// A scheme's public key, as its verifier takes it, from its signing key: for ECDSA, the address.
export async function publicKeyOf(scheme: Scheme, keys: SigningKeys): Promise<string> {
  if (scheme === "ecdsa") return hex(ecdsaAddress(keys.ecdsa!));
  return hex(scheme === "falcon" ? await falconPublicKey(keys.falcon!) : await sphincsPublicKey(keys.sphincs!));
}

// Saves the account under its own key, and counts it if it's new. Only adding an account writes the count.
export async function saveAccount(account: Account): Promise<void> {
  const { index, restored: _, ...stored } = account;
  await chrome.storage.local.set({ [keyOf("account", index)]: stored });
  if (index >= (await accountCount())) await chrome.storage.local.set({ [COUNT_KEY]: index + 1 });
}

export async function loadAccount(index = 0): Promise<Account | undefined> {
  const key = keyOf("account", index);
  const stored = (await chrome.storage.local.get(key))[key] as Omit<Account, "index"> | undefined;
  return stored && { index, ...stored, name: stored.name ?? `Account ${index + 1}` };
}

// Names are the extension's own: they aren't on chain, so a restored account starts as "Account N".
export async function renameAccount(index: number, name: string): Promise<void> {
  const account = await loadAccount(index);
  if (!account) throw new Error("No such account");
  await saveAccount({ ...account, name: name.trim() || `Account ${index + 1}` });
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

// The wallet's ABI types for its scheme list and rules (AgileWallet.Scheme[], AgileWallet.Rule[]).
const SCHEME_TUPLE = {
  type: "tuple",
  components: [
    { name: "verifier", type: "address" },
    { name: "publicKey", type: "bytes" },
  ],
} as const;
export const SCHEMES_ABI = { ...SCHEME_TUPLE, type: "tuple[]" } as const;
export const RULES_ABI = {
  type: "tuple[]",
  components: [{ name: "signal", type: "address" }, { ...SCHEME_TUPLE, name: "scheme" }],
} as const;

export const abiSchemes = (schemes: { scheme: Scheme; publicKey: string }[]) =>
  schemes.map((s) => ({ verifier: VERIFIERS[s.scheme] as Hex, publicKey: s.publicKey as Hex }));
export const abiRules = (rules: Rule[]) => rules.map((r) => ({ signal: r.signal as Hex, scheme: abiSchemes([r])[0] }));

const SCHEMES_HASH = toFunctionSelector("schemesHash()");
const RULES_HASH = toFunctionSelector("rulesHash()");
const BROKEN_AT = toFunctionSelector("brokenAt()");
const NO_RULES = `0x${"00".repeat(32)}`;

// keccak256(abi.encode(Scheme[])): what AgileWallet stores for its scheme list.
export function schemesHash(schemes: Account["schemes"]): string {
  return keccak256(encodeAbiParameters([SCHEMES_ABI], [abiSchemes(schemes)]));
}

// keccak256(abi.encode(Rule[])), or zero for none: what AgileWallet stores for its rules.
export function rulesHash(rules: Rule[]): string {
  return rules.length === 0 ? NO_RULES : keccak256(encodeAbiParameters([RULES_ABI], [abiRules(rules)]));
}

async function onchainSchemesHash(network: Network, address: string): Promise<string> {
  return rpc<string>(network.url, "eth_call", [{ to: address, data: SCHEMES_HASH }, "latest"]);
}

async function onchainRulesHash(network: Network, address: string): Promise<string> {
  return rpc<string>(network.url, "eth_call", [{ to: address, data: RULES_HASH }, "latest"]);
}

// When each known signal was raised (seconds since the epoch), or 0 while it isn't, by lowercase address. A signal
// not deployed on this network reads as not raised.
export type SignalStates = Record<string, number>;

export async function signalStates(network: Network): Promise<SignalStates> {
  const entries = await Promise.all(
    SIGNALS.map(async (s) => {
      const brokenAt = await rpc<string>(network.url, "eth_call", [{ to: s.address, data: BROKEN_AT }, "latest"]);
      return [s.address.toLowerCase(), brokenAt === "0x" ? 0 : Number(BigInt(brokenAt))] as const;
    }),
  );
  return Object.fromEntries(entries);
}

// The account's rules whose signal is raised.
export function raisedRules(account: Account, signals: SignalStates): Rule[] {
  return (account.rules ?? []).filter((r) => (signals[r.signal.toLowerCase()] ?? 0) > 0);
}

// A change of schemes and rules that was sent but may not be mined yet, per account. Changes saved before rules
// existed are just the scheme list.
export interface PendingChange {
  schemes: Account["schemes"];
  rules: Rule[];
}

export async function savePendingSchemes(index: number, change: PendingChange): Promise<void> {
  await chrome.storage.local.set({ [keyOf("pendingSchemes", index)]: change });
}

export async function clearPendingSchemes(index: number): Promise<void> {
  await chrome.storage.local.set({ [keyOf("pendingSchemes", index)]: null });
}

// The stored account, after adopting a pending scheme change the chain now has. A change is only saved once mined,
// and a popup's code stops when it closes, so a change mined after its popup closed is caught up here.
export async function syncAccount(network: Network, index: number): Promise<Account | undefined> {
  const account = await loadAccount(index);
  const key = keyOf("pendingSchemes", index);
  const stored = (await chrome.storage.local.get(key))[key] as PendingChange | Account["schemes"] | null | undefined;
  if (!account) return account;
  if (!stored) return dropUnsetRules(network, account);
  const pending = Array.isArray(stored) ? { schemes: stored, rules: account.rules ?? [] } : stored;
  const address = walletAddress(account.owner);
  const [schemes, rules] = await Promise.all([onchainSchemesHash(network, address), onchainRulesHash(network, address)]);
  if (schemes !== schemesHash(pending.schemes) || rules !== rulesHash(pending.rules)) return account; // not mined (yet), or it failed
  const updated = { ...account, ...pending };
  await saveAccount(updated);
  await clearPendingSchemes(index);
  return updated;
}

// Safeguards saved before deployment that the deployed wallet doesn't have (its first transaction's setRules frame
// failed, or another device deployed it without them) are dropped: transactions validate against the wallet's rules,
// and the Account screen shows the safeguards as off, to set again.
async function dropUnsetRules(network: Network, account: Account): Promise<Account> {
  if ((account.rules ?? []).length === 0) return account;
  const address = walletAddress(account.owner);
  const [schemes, rules] = await Promise.all([onchainSchemesHash(network, address), onchainRulesHash(network, address)]);
  if (rules !== NO_RULES || schemes !== schemesHash(account.schemes)) return account; // undeployed reads as "0x"
  const updated = { ...account, rules: [] };
  await saveAccount(updated);
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
  schemesMatch: boolean; // the stored schemes and rules are the wallet's on chain (always, before deployment)
  signals: SignalStates;
}

export async function accountState(network: Network, account: Account): Promise<AccountState> {
  const address = walletAddress(account.owner);
  const [balance, code, signals] = await Promise.all([
    rpc<string>(network.url, "eth_getBalance", [address, "latest"]),
    rpc<string>(network.url, "eth_getCode", [address, "latest"]),
    signalStates(network),
  ]);
  const deployed = code !== "0x";
  const onchain = deployed && (await Promise.all([onchainSchemesHash(network, address), onchainRulesHash(network, address)]));
  const schemesMatch = !onchain || (onchain[0] === schemesHash(account.schemes) && onchain[1] === rulesHash(account.rules ?? []));
  return { address, balance: BigInt(balance), deployed, schemesMatch, signals };
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
