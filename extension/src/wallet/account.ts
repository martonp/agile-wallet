import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { deriveSigningKeys, wipeKeys } from "./derive";
import { ecdsaAddress } from "./ecdsa";
import { falconPublicKey } from "./falcon";
import { CONTRACTS, type Network } from "./network";
import { rpc } from "./rpc";
import { SCHEMES, type Scheme } from "./schemes";
import { sphincsPublicKey } from "./sphincs";

// What the extension keeps in the clear: nothing here is secret. The verifiers' addresses are in CONTRACTS.
export interface Account {
  owner: string; // the ECDSA address that authorises the wallet's deployment, and fixes its address
  schemes: { scheme: Scheme; publicKey: string }[]; // in SCHEMES order; ECDSA's public key is its address
}

const KEY = "account";

// The account of `seed` with the chosen schemes. The owner is always the ECDSA key, whether or not ECDSA is one of
// the schemes.
export async function deriveAccount(seed: Uint8Array, schemes: Scheme[]): Promise<Account> {
  const chosen = SCHEMES.filter((s) => schemes.includes(s));
  if (chosen.length === 0) throw new Error("Choose at least one scheme");
  const keys = deriveSigningKeys(seed, ["ecdsa", ...chosen]);
  try {
    const owner = hex(ecdsaAddress(keys.ecdsa!));
    const publicKey = async (scheme: Scheme) => {
      if (scheme === "ecdsa") return owner;
      return hex(scheme === "falcon" ? await falconPublicKey(keys.falcon!) : await sphincsPublicKey(keys.sphincs!));
    };
    const out: Account["schemes"] = [];
    for (const scheme of chosen) out.push({ scheme, publicKey: await publicKey(scheme) });
    return { owner, schemes: out };
  } finally {
    wipeKeys(keys);
  }
}

export async function saveAccount(account: Account): Promise<void> {
  await chrome.storage.local.set({ [KEY]: account });
}

export async function loadAccount(): Promise<Account | undefined> {
  return (await chrome.storage.local.get(KEY))[KEY] as Account | undefined;
}

const WALLET_ADDRESS = hex(keccak_256(new TextEncoder().encode("walletAddress(address)")).slice(0, 4));

// AgileWalletFactory.walletAddress(owner): the CREATE2 address, known before deployment.
export async function walletAddress(network: Network, owner: string): Promise<string> {
  const data = WALLET_ADDRESS + owner.slice(2).toLowerCase().padStart(64, "0");
  const result = await rpc<string>(network.rpcUrl, "eth_call", [{ to: CONTRACTS.factory, data }, "latest"]);
  return `0x${result.slice(-40)}`;
}

export interface AccountState {
  address: string;
  balance: bigint; // wei
  deployed: boolean;
}

export async function accountState(network: Network, account: Account): Promise<AccountState> {
  const address = await walletAddress(network, account.owner);
  const [balance, code] = await Promise.all([
    rpc<string>(network.rpcUrl, "eth_getBalance", [address, "latest"]),
    rpc<string>(network.rpcUrl, "eth_getCode", [address, "latest"]),
  ]);
  return { address, balance: BigInt(balance), deployed: code !== "0x" };
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
