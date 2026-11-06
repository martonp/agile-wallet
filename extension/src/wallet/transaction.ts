import { getProfile } from "@forshtat/hegota-support/profiles";
import { toWire } from "@forshtat/hegota-support/rpc";
import * as tx from "@forshtat/hegota-support/tx";
import type { FrameTx, SignatureEntry } from "@forshtat/hegota-support/tx";
import { type Address, type Hex, bytesToHex, encodeFunctionData, hexToBytes } from "viem";
import { type Account, accountState, clearPendingSchemes, publicKeyOf, saveAccount, savePendingSchemes } from "./account";
import type { SigningKeys } from "./derive";
import { ecdsaSign } from "./ecdsa";
import { falconSign } from "./falcon";
import { withSigningKeys } from "./keyring";
import { CONTRACTS, type Network, VERIFIERS, loadNetwork } from "./network";
import { rpc } from "./rpc";
import { SCHEMES, type Scheme } from "./schemes";
import { sphincsSign } from "./sphincs";

// The EIP-8141 encoding of the devnet's ethrex build, which the VPR sidecar also speaks.
const PROFILE = getProfile("ethrex-eip8141-tracer");

const SCHEMES_ABI = {
  type: "tuple[]",
  components: [
    { name: "verifier", type: "address" },
    { name: "publicKey", type: "bytes" },
  ],
} as const;
const WALLET_ABI = [
  { type: "function", name: "validate", stateMutability: "nonpayable", inputs: [{ ...SCHEMES_ABI, name: "current" }], outputs: [] },
  { type: "function", name: "setSchemes", stateMutability: "nonpayable", inputs: [{ ...SCHEMES_ABI, name: "newSchemes" }], outputs: [] },
] as const;
const FACTORY_ABI = [
  {
    type: "function",
    name: "deploy",
    stateMutability: "nonpayable",
    inputs: [{ name: "owner", type: "address" }, { ...SCHEMES_ABI, name: "initial" }],
    outputs: [{ type: "address" }],
  },
] as const;

export interface Transfer {
  to: Address;
  value: bigint; // wei
}

// What a transaction's SENDER frame does: send ETH, or replace the wallet's schemes.
export type Action = ({ type: "transfer" } & Transfer) | { type: "setSchemes"; schemes: Account["schemes"] };

export interface TransferContext {
  account: Account;
  wallet: Address;
  deployed: boolean;
  chainId: bigint;
  nonce: bigint;
  maxFeePerGas: bigint;
}

export interface Limits {
  deploy: bigint; // execution gas of the deploy frame; unused once deployed
  verify: bigint;
}

// The schemes whose signatures a transaction needs, in order: the wallet's, then the ones a setSchemes adds
// (AgileWallet.validate).
export function requiredSchemes(account: Account, action: Action): Account["schemes"] {
  if (action.type !== "setSchemes") return account.schemes;
  const same = (a: Account["schemes"][number], b: Account["schemes"][number]) =>
    a.scheme === b.scheme && a.publicKey.toLowerCase() === b.publicKey.toLowerCase();
  return [...account.schemes, ...action.schemes.filter((n) => !account.schemes.some((c) => same(c, n)))];
}

const abiSchemes = (schemes: Account["schemes"]) =>
  schemes.map((s) => ({ verifier: VERIFIERS[s.scheme] as Address, publicKey: s.publicKey as Hex }));

// The first transaction also deploys the wallet: a DEFAULT frame calls the factory, and the owner's SECP256K1
// entry authorises it (an ECDSA scheme's entry, by the owner, does that too).
export function buildTransaction(ctx: TransferContext, action: Action, limits: Limits): FrameTx {
  const schemes = abiSchemes(ctx.account.schemes);
  const owner = ctx.account.owner as Address;
  const frames = [];
  if (!ctx.deployed) {
    const data = encodeFunctionData({ abi: FACTORY_ABI, functionName: "deploy", args: [owner, schemes] });
    frames.push(tx.frame(PROFILE, "DEFAULT", { target: CONTRACTS.factory as Address, execution: limits.deploy, state: 300_000n, data }));
  }
  const validate = encodeFunctionData({ abi: WALLET_ABI, functionName: "validate", args: [schemes] });
  frames.push(tx.frame(PROFILE, "VERIFY", { scope: "EXECUTION_AND_PAYMENT", execution: limits.verify, data: validate }));
  if (action.type === "transfer") {
    // State gas covers creating the recipient's account if it is new.
    frames.push(tx.frame(PROFILE, "SENDER", { target: action.to, execution: 50_000n, state: 200_000n, value: action.value }));
  } else {
    const data = encodeFunctionData({ abi: WALLET_ABI, functionName: "setSchemes", args: [abiSchemes(action.schemes)] });
    frames.push(tx.frame(PROFILE, "SENDER", { target: ctx.wallet, execution: SET_SCHEMES_GAS, state: 50_000n, data }));
  }

  const required = requiredSchemes(ctx.account, action);
  const signatures: SignatureEntry[] = required.map((s) =>
    s.scheme === "ecdsa"
      ? tx.secp256k1Placeholder(PROFILE, owner)
      : { scheme: tx.sigScheme(PROFILE, "ARBITRARY"), signer: "0x", msg: "0x", signature: "0x" },
  );
  if (!ctx.deployed && !required.some((s) => s.scheme === "ecdsa")) signatures.push(tx.secp256k1Placeholder(PROFILE, owner));

  return tx.newTx({
    chainId: ctx.chainId,
    sender: ctx.wallet,
    nonceSeq: ctx.nonce,
    frames,
    signatures,
    fees: { maxFeePerGas: ctx.maxFeePerGas, maxPriorityFeePerGas: TIP },
  });
}

// Fixed, generous gas limits: well above what the local devnet measured (Falcon at its expensive level, where
// hash-to-point needs a ninth SHAKE block), so that sends don't fail on gas. The limits count against the VPR
// mempool's validation budget; the sidecar's stand-in credits for Falcon and SPHINCS- are sized to cover them, and
// an ECDSA-only wallet, which earns no credit, stays under 100,000.
const DEPLOY_GAS = { base: 52_000n, ecdsa: 4_000n, sphincs: 6_000n, falcon: 20_000n };
const VERIFY_GAS = { base: 30_000n, ecdsa: 6_000n, sphincs: 150_000n, falcon: 800_000n };
const VERIFY_GAS_SET_SCHEMES = 40_000n; // validate also decodes the new list from the SENDER frame
const SET_SCHEMES_GAS = 200_000n; // checks the new list, stores its hash and logs it (a Falcon key is 1 KB)

// The deploy frame checks the wallet's current schemes; VERIFY checks every required scheme's signature.
export function fixedLimits(account: Account, deployed: boolean, action: Action): Limits {
  const sum = (table: Record<Scheme | "base", bigint>, schemes: Account["schemes"]) =>
    schemes.reduce((g, s) => g + table[s.scheme], table.base);
  const verify = sum(VERIFY_GAS, requiredSchemes(account, action)) + (action.type === "setSchemes" ? VERIFY_GAS_SET_SCHEMES : 0n);
  return { deploy: deployed ? 0n : sum(DEPLOY_GAS, account.schemes), verify };
}

// The signature entries of a transaction, in order: one per required scheme, then the owner's if there is one more.
export function signers(unsigned: FrameTx, required: Account["schemes"]): Signer[] {
  return unsigned.signatures.map((_, i) =>
    i < required.length ? { scheme: required[i].scheme, owner: false } : { scheme: "ecdsa", owner: true },
  );
}

export interface Signer {
  scheme: Scheme;
  owner: boolean; // the owner's entry that authorises deployment, when ECDSA isn't one of the schemes
}

// Signs every entry over the canonical sig hash. `onProgress` hears of each signature before and after it; awaiting
// it lets the popup paint "signing" before a signer blocks the thread for seconds.
export async function signTransaction(
  unsigned: FrameTx,
  required: Account["schemes"],
  keys: SigningKeys,
  onProgress: (progress: Progress) => void | Promise<void> = () => {},
): Promise<FrameTx> {
  const digest = hexToBytes(tx.sigHash(PROFILE, unsigned));
  const entries = signers(unsigned, required);
  const signatures: SignatureEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    await onProgress({ type: "signing", index: i });
    const started = performance.now();
    const signature = await signWith(entries[i].scheme, keys, digest);
    await onProgress({ type: "signed", index: i, ms: performance.now() - started });
    signatures.push({ ...unsigned.signatures[i], signature: bytesToHex(signature) });
  }
  return { ...unsigned, signatures };
}

async function signWith(scheme: Scheme, keys: SigningKeys, digest: Uint8Array): Promise<Uint8Array> {
  if (scheme === "ecdsa") return ecdsaSign(keys.ecdsa!, digest);
  if (scheme === "falcon") return falconSign(keys.falcon!, digest);
  return sphincsSign(keys.sphincs!, digest);
}

export type Progress =
  | { type: "signers"; signers: Signer[] } // what is about to be signed, in order
  | { type: "signing"; index: number }
  | { type: "signed"; index: number; ms: number }
  | { type: "sending" }
  | { type: "mining" };

type OnProgress = (progress: Progress) => void | Promise<void>;

export interface Sent {
  hash: Hex;
  block: bigint;
  ok: boolean; // every frame succeeded
}

export function sendTransfer(password: string, account: Account, transfer: Transfer, onProgress: OnProgress = () => {}): Promise<Sent> {
  return submit(password, account, [], async () => ({ type: "transfer", ...transfer }), onProgress);
}

// Replaces the wallet's schemes with `next`. The transaction needs signatures from the schemes on now and the ones
// added; the new ones' public keys come from the same seed. Once it is mined, the stored account follows.
export async function changeSchemes(password: string, account: Account, next: Scheme[], onProgress: OnProgress = () => {}): Promise<Sent> {
  const chosen = SCHEMES.filter((s) => next.includes(s));
  if (chosen.length === 0) throw new Error("Keep at least one scheme");
  const added = chosen.filter((s) => !account.schemes.some((c) => c.scheme === s));
  let schemes: Account["schemes"] = [];
  const sent = await submit(
    password,
    account,
    added,
    async (keys) => {
      schemes = [];
      for (const scheme of chosen) {
        const existing = account.schemes.find((c) => c.scheme === scheme);
        schemes.push({ scheme, publicKey: existing ? existing.publicKey : await publicKeyOf(scheme, keys) });
      }
      // Remembered before sending: if the popup closes before the change is mined, syncAccount adopts it later.
      await savePendingSchemes(schemes);
      return { type: "setSchemes", schemes };
    },
    onProgress,
  );
  if (sent.ok) {
    await saveAccount({ owner: account.owner, schemes });
    await clearPendingSchemes();
  }
  return sent;
}

// Signs once with the account's keys (and `extraKeys`, which `plan` may use), at fixed gas limits, and sends the
// transaction through the VPR mempool, which simulates it before accepting it.
async function submit(
  password: string,
  account: Account,
  extraKeys: Scheme[],
  plan: (keys: SigningKeys) => Promise<Action>,
  onProgress: OnProgress,
): Promise<Sent> {
  const network = await loadNetwork();
  const ctx = await transferContext(network, account);
  const needed = [...new Set<Scheme>([...account.schemes.map((s) => s.scheme), ...extraKeys, ...(ctx.deployed ? [] : ["ecdsa" as const])])];

  const signed = await withSigningKeys(password, needed, async (keys) => {
    const action = await plan(keys);
    const required = requiredSchemes(account, action);
    const unsigned = buildTransaction(ctx, action, fixedLimits(account, ctx.deployed, action));
    await onProgress({ type: "signers", signers: signers(unsigned, required) });
    return signTransaction(unsigned, required, keys, onProgress);
  });

  await onProgress({ type: "sending" });
  const hash = tx.txHash(PROFILE, signed);
  await rpc(network.sidecarUrl, "eth_sendFrameTransaction", [toWire(signed)]);

  await onProgress({ type: "mining" });
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const receipt = await rpc<Receipt | null>(network.rpcUrl, "eth_getTransactionReceipt", [hash]);
    if (receipt) {
      const ok = receipt.frameReceipts ? receipt.frameReceipts.every((f) => f.status === "0x1") : receipt.status === "0x1";
      return { hash, block: BigInt(receipt.blockNumber), ok };
    }
  }
  throw new Error(`Not mined within 2 minutes (${hash})`);
}

interface Receipt {
  status?: Hex;
  blockNumber: Hex;
  frameReceipts?: { status: Hex }[];
}

// A fixed tip, as the devnet scripts pay. Following the node's suggested price instead feeds back on a quiet chain:
// the suggestion comes from recent tips, so paying above it raises it for the next transaction.
const TIP = 2_000_000_000n; // 2 gwei

async function transferContext(network: Network, account: Account): Promise<TransferContext> {
  const state = await accountState(network, account);
  const [chainId, nonce, block] = await Promise.all([
    rpc<Hex>(network.rpcUrl, "eth_chainId"),
    rpc<Hex>(network.rpcUrl, "eth_getTransactionCount", [state.address, "latest"]),
    rpc<{ baseFeePerGas?: Hex }>(network.rpcUrl, "eth_getBlockByNumber", ["latest", false]),
  ]);
  return {
    account,
    wallet: state.address as Address,
    deployed: state.deployed,
    chainId: BigInt(chainId),
    nonce: BigInt(nonce),
    maxFeePerGas: 2n * BigInt(block.baseFeePerGas ?? "0x0") + TIP, // room for the base fee to double
  };
}
