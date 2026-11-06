import { getProfile } from "@forshtat/hegota-support/profiles";
import { toWire } from "@forshtat/hegota-support/rpc";
import * as tx from "@forshtat/hegota-support/tx";
import type { FrameTx, SignatureEntry } from "@forshtat/hegota-support/tx";
import { type Address, type Hex, bytesToHex, encodeFunctionData, hexToBytes } from "viem";
import {
  type Account,
  type PendingChange,
  RULES_ABI,
  type Rule,
  SCHEMES_ABI,
  type SignalStates,
  abiRules,
  abiSchemes,
  accountState,
  clearPendingSchemes,
  formatEth,
  publicKeyOf,
  raisedRules,
  rulesHash,
  signalStates,
  saveAccount,
  savePendingSchemes,
  schemesHash,
} from "./account";
import type { SigningKeys } from "./derive";
import { withSigningKeys } from "./keyring";
import { CONTRACTS, type Network, SIGNALS, loadNetwork } from "./network";
import { SAFEGUARD_SWITCHED_ON } from "./errors";
import { type Receipt, addEntry, dropEntry, receiptOk, settleEntry } from "./history";
import { rpc } from "./rpc";
import { signOffThread } from "./signer";
import { SCHEMES, type Scheme } from "./schemes";

// The EIP-8141 encoding of the devnet's ethrex build, which the VPR sidecar also speaks.
const PROFILE = getProfile("ethrex-eip8141-tracer");

const WALLET_ABI = [
  {
    type: "function",
    name: "validate",
    stateMutability: "nonpayable",
    inputs: [{ ...SCHEMES_ABI, name: "current" }, { ...RULES_ABI, name: "rules" }],
    outputs: [],
  },
  { type: "function", name: "setSchemes", stateMutability: "nonpayable", inputs: [{ ...SCHEMES_ABI, name: "newSchemes" }], outputs: [] },
  { type: "function", name: "setRules", stateMutability: "nonpayable", inputs: [{ ...RULES_ABI, name: "newRules" }], outputs: [] },
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

// What a transaction's SENDER frames do: send ETH, or replace the wallet's schemes and rules (a setSchemes frame if
// the schemes change, then a setRules frame if the rules do).
export type Action = ({ type: "transfer" } & Transfer) | ({ type: "configure" } & PendingChange);

export interface TransferContext {
  account: Account;
  wallet: Address;
  deployed: boolean;
  balance: bigint; // wei
  chainId: bigint;
  nonce: bigint;
  maxFeePerGas: bigint;
  signals: SignalStates;
}

export interface Limits {
  deploy: bigint; // execution gas of the deploy frame; unused once deployed
  verify: bigint;
}

const changesSchemes = (account: Account, action: Action) =>
  action.type === "configure" && schemesHash(action.schemes) !== schemesHash(account.schemes);
const changesRules = (account: Account, action: Action) =>
  action.type === "configure" && rulesHash(action.rules) !== rulesHash(account.rules ?? []);

// The schemes whose signatures a transaction needs, in order (AgileWallet.validate): the wallet's, the backups of its
// raised rules, then what the setSchemes frame adds, then the backups of the setRules frame's rules.
export function requiredSchemes(account: Account, action: Action, signals: SignalStates = {}): Account["schemes"] {
  const backups = (rules: Rule[]) => rules.map(({ scheme, publicKey }) => ({ scheme, publicKey }));
  let required = union(account.schemes, backups(raisedRules(account, signals)));
  if (action.type === "configure") {
    if (changesSchemes(account, action)) required = union(required, action.schemes);
    if (changesRules(account, action)) required = union(required, backups(action.rules));
  }
  return required;
}

// `a` followed by the schemes of `b` that aren't in it (AgileWallet._union).
function union(a: Account["schemes"], b: Account["schemes"]): Account["schemes"] {
  const same = (x: Account["schemes"][number], y: Account["schemes"][number]) =>
    x.scheme === y.scheme && x.publicKey.toLowerCase() === y.publicKey.toLowerCase();
  const out = [...a];
  for (const s of b) if (!out.some((o) => same(o, s))) out.push(s);
  return out;
}

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
  const validate = encodeFunctionData({ abi: WALLET_ABI, functionName: "validate", args: [schemes, abiRules(ctx.account.rules ?? [])] });
  frames.push(tx.frame(PROFILE, "VERIFY", { scope: "EXECUTION_AND_PAYMENT", execution: limits.verify, data: validate }));
  if (action.type === "transfer") {
    // State gas covers creating the recipient's account if it is new.
    frames.push(tx.frame(PROFILE, "SENDER", { target: action.to, execution: 50_000n, state: 200_000n, value: action.value }));
  } else {
    if (changesSchemes(ctx.account, action)) {
      const data = encodeFunctionData({ abi: WALLET_ABI, functionName: "setSchemes", args: [abiSchemes(action.schemes)] });
      frames.push(tx.frame(PROFILE, "SENDER", { target: ctx.wallet, execution: SET_SCHEMES_GAS, state: 50_000n, data }));
    }
    if (changesRules(ctx.account, action)) {
      // State gas covers storing the rules hash in a slot that was empty (more than clearing or replacing it needs).
      const data = encodeFunctionData({ abi: WALLET_ABI, functionName: "setRules", args: [abiRules(action.rules)] });
      frames.push(tx.frame(PROFILE, "SENDER", { target: ctx.wallet, execution: SET_RULES_GAS, state: 200_000n, data }));
    }
  }

  const required = requiredSchemes(ctx.account, action, ctx.signals);
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
const VERIFY_GAS_SET_RULES = 40_000n; // and the new rules from theirs
const VERIFY_GAS_PER_RULE = 10_000n; // validate decodes each rule and asks its signal whether it is raised
const SET_SCHEMES_GAS = 200_000n; // checks the new list, stores its hash and logs it (a Falcon key is 1 KB)
const SET_RULES_GAS = 150_000n; // calls each signal, stores the rules' hash and logs them

// The deploy frame checks the wallet's current schemes; VERIFY checks every required scheme's signature, and every
// rule's signal.
export function fixedLimits(account: Account, deployed: boolean, action: Action, signals: SignalStates = {}): Limits {
  const sum = (table: Record<Scheme | "base", bigint>, schemes: Account["schemes"]) =>
    schemes.reduce((g, s) => g + table[s.scheme], table.base);
  const verify =
    sum(VERIFY_GAS, requiredSchemes(account, action, signals)) +
    VERIFY_GAS_PER_RULE * BigInt((account.rules ?? []).length) +
    (changesSchemes(account, action) ? VERIFY_GAS_SET_SCHEMES : 0n) +
    (changesRules(account, action) ? VERIFY_GAS_SET_RULES : 0n);
  return { deploy: deployed ? 0n : sum(DEPLOY_GAS, account.schemes), verify };
}

const SIGNATURE_BYTES: Record<Scheme, number> = { ecdsa: 65, falcon: 1064, sphincs: 3688 };

// The most a transaction can cost in fees, which the mempool requires the balance to cover on top of the value:
// every gas limit (each frame's execution and state gas, plus the transaction's own cost, bounded here by 21,000
// and 16 gas per byte of its encoding with signatures) at the max fee per gas.
export function maxFee(ctx: TransferContext, action: Action): bigint {
  const unsigned = buildTransaction(ctx, action, fixedLimits(ctx.account, ctx.deployed, action, ctx.signals));
  const frames = unsigned.frames.reduce((gas, f) => gas + f.limits.execution + f.limits.state, 0n);
  const signatureBytes = signers(unsigned, requiredSchemes(ctx.account, action, ctx.signals)).reduce((n, s) => n + SIGNATURE_BYTES[s.scheme], 0);
  const bytes = (tx.encodeTx(PROFILE, unsigned).length - 2) / 2 + signatureBytes;
  return (frames + 21_000n + 16n * BigInt(bytes)) * ctx.maxFeePerGas;
}

// What a transfer from `account` needs on top of its value, and what the wallet holds, for the Send screen. The fee
// is that of the largest transfer (all of the balance, to an address with no zero bytes), whose encoding is the
// longest, so it covers any real one: balance - fee is a Max amount that passes the check before signing.
export async function transferFee(account: Account): Promise<{ maxFee: bigint; balance: bigint }> {
  const ctx = await transferContext(await loadNetwork(), account);
  const largest: Action = { type: "transfer", to: `0x${"ff".repeat(20)}`, value: ctx.balance };
  return { maxFee: maxFee(ctx, largest), balance: ctx.balance };
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

// Signs every entry over the canonical sig hash. `onProgress` hears of each signature before and after it.
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

function signWith(scheme: Scheme, keys: SigningKeys, digest: Uint8Array): Promise<Uint8Array> {
  return signOffThread(scheme, keys[scheme]!, digest);
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

// A safeguard to set: once `signal` is raised, `scheme` must also sign.
export interface RuleChoice {
  signal: string;
  scheme: Scheme;
}

// Replaces the wallet's schemes and rules with `next`, in one transaction. It needs signatures from the schemes on
// now, the raised rules' backups, the schemes added and every new rule's backup; their public keys come from the
// same seed. Once it is mined, the stored account follows.
export async function changeSchemes(
  password: string,
  account: Account,
  next: { schemes: Scheme[]; rules: RuleChoice[] },
  onProgress: OnProgress = () => {},
): Promise<Sent> {
  const chosen = SCHEMES.filter((s) => next.schemes.includes(s));
  if (chosen.length === 0) throw new Error("Keep at least one scheme");
  // Only signals the extension reads: a raised signal it doesn't read would leave a backup unsigned.
  if (next.rules.some((r) => !SIGNALS.some((s) => s.address.toLowerCase() === r.signal.toLowerCase()))) {
    throw new Error("Unknown break signal");
  }
  // Each name has one key per seed, so names tell whether anything changes.
  const sameRules = (a: { signal: string; scheme: Scheme }[], b: { signal: string; scheme: Scheme }[]) =>
    a.length === b.length && a.every((r, i) => r.signal.toLowerCase() === b[i].signal.toLowerCase() && r.scheme === b[i].scheme);
  if (chosen.join() === account.schemes.map((s) => s.scheme).join() && sameRules(next.rules, account.rules ?? [])) {
    throw new Error("Nothing to change");
  }
  // Public keys the account already has are reused; every scheme the change names is derived, since any of them can
  // be required (a backup that isn't raised, say, becoming a scheme).
  const known = [...account.schemes, ...(account.rules ?? [])];
  let change: PendingChange = { schemes: [], rules: [] };
  const sent = await submit(
    password,
    account,
    [...chosen, ...next.rules.map((r) => r.scheme)],
    async (keys) => {
      const publicKey = async (scheme: Scheme) => known.find((k) => k.scheme === scheme)?.publicKey ?? publicKeyOf(scheme, keys);
      const schemes = [];
      for (const scheme of chosen) schemes.push({ scheme, publicKey: await publicKey(scheme) });
      const rules = [];
      for (const r of next.rules) rules.push({ signal: r.signal, scheme: r.scheme, publicKey: await publicKey(r.scheme) });
      change = { schemes, rules };
      // Remembered before sending: if the popup closes before the change is mined, syncAccount adopts it later.
      await savePendingSchemes(account.index, change);
      return { type: "configure", ...change };
    },
    onProgress,
  );
  if (sent.ok) {
    await saveAccount({ ...account, ...change });
    await clearPendingSchemes(account.index);
  }
  return sent;
}

// Before deployment the scheme list exists only here: the address depends on the owner alone, and the factory takes
// whatever list the first transaction carries. So a change is just saved, with no transaction, fee or signatures.
// The password is needed only to derive the public keys of schemes being added. Refuses if the wallet has been
// deployed meanwhile (from another device, say), since then the change takes a transaction.
export async function changeSchemesBeforeDeployment(password: string, account: Account, next: Scheme[]): Promise<Account> {
  const chosen = SCHEMES.filter((s) => next.includes(s));
  if (chosen.length === 0) throw new Error("Keep at least one scheme");
  if ((await accountState(await loadNetwork(), account)).deployed) {
    throw new Error("The wallet has been deployed since this screen opened, so changing its schemes now takes a transaction.");
  }
  const added = chosen.filter((s) => !account.schemes.some((c) => c.scheme === s));
  const publicKeys: Partial<Record<Scheme, string>> = {};
  if (added.length > 0) {
    await withSigningKeys(
      password,
      ["ecdsa", ...added],
      async (keys) => {
        if ((await publicKeyOf("ecdsa", keys)).toLowerCase() !== account.owner.toLowerCase()) {
          throw new Error("These keys aren't this account's: its owner doesn't match");
        }
        for (const scheme of added) publicKeys[scheme] = await publicKeyOf(scheme, keys);
      },
      account.index,
    );
  }
  const schemes = chosen.map((scheme) => ({
    scheme,
    publicKey: account.schemes.find((c) => c.scheme === scheme)?.publicKey ?? publicKeys[scheme]!,
  }));
  const updated = { ...account, schemes };
  await saveAccount(updated);
  return updated;
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
  // ECDSA always: it is also the check that these keys are this account's. Raised rules' backups sign too.
  const needed = [
    ...new Set<Scheme>([
      "ecdsa",
      ...account.schemes.map((s) => s.scheme),
      ...raisedRules(account, ctx.signals).map((r) => r.scheme),
      ...extraKeys,
    ]),
  ];

  // What the history records: the action, and the scheme of each signature the transaction carries.
  let action: Action | undefined;
  let signedBy: Scheme[] = [];
  const record: OnProgress = (progress) => {
    if (progress.type === "signers") signedBy = progress.signers.map((s) => s.scheme);
    return onProgress(progress);
  };

  const signed = await withSigningKeys(
    password,
    needed,
    async (keys) => {
      if ((await publicKeyOf("ecdsa", keys)).toLowerCase() !== account.owner.toLowerCase()) {
        throw new Error("These keys aren't this account's: its owner doesn't match");
      }
      action = await plan(keys);
      // Checked before signing: the mempool would refuse it after seconds of signing, with a message in wei.
      const needs = (action.type === "transfer" ? action.value : 0n) + maxFee(ctx, action);
      if (needs > ctx.balance) {
        throw new Error(`Not enough ETH: this needs up to ${formatEth(needs, 6)} ETH with the network fee, and the wallet holds ${formatEth(ctx.balance, 6)}.`);
      }
      const required = requiredSchemes(account, action, ctx.signals);
      const unsigned = buildTransaction(ctx, action, fixedLimits(account, ctx.deployed, action, ctx.signals));
      await record({ type: "signers", signers: signers(unsigned, required) });
      return signTransaction(unsigned, required, keys, record);
    },
    account.index,
  );

  await onProgress({ type: "sending" });
  const hash = tx.txHash(PROFILE, signed);
  try {
    await rpc(network.sidecarUrl, "eth_sendFrameTransaction", [toWire(signed)]);
  } catch (e) {
    if (await safeguardSwitchedOn(network, ctx)) throw new Error(SAFEGUARD_SWITCHED_ON);
    throw e;
  }
  const done = action!;
  await addEntry(account.index, {
    hash,
    time: Date.now(),
    ...(done.type === "transfer"
      ? { kind: "transfer" as const, to: done.to, value: done.value.toString() }
      : { kind: "setSchemes" as const, schemes: done.schemes.map((s) => s.scheme), rules: done.rules.map((r) => r.scheme) }),
    deploys: !ctx.deployed,
    signers: signedBy,
    status: "pending",
  });

  await onProgress({ type: "mining" });
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const receipt = await rpc<Receipt | null>(network.rpcUrl, "eth_getTransactionReceipt", [hash]);
    if (receipt) {
      const ok = receiptOk(receipt);
      await settleEntry(account.index, hash, receipt);
      return { hash, block: BigInt(receipt.blockNumber), ok };
    }
  }
  // The mempool drops a pending transaction that lacks a newly required signature. A last look for its receipt first,
  // since a dropped entry is never checked again.
  const receipt = await rpc<Receipt | null>(network.rpcUrl, "eth_getTransactionReceipt", [hash]);
  if (receipt) {
    await settleEntry(account.index, hash, receipt);
    return { hash, block: BigInt(receipt.blockNumber), ok: receiptOk(receipt) };
  }
  if (await safeguardSwitchedOn(network, ctx)) {
    await dropEntry(account.index, hash);
    throw new Error(SAFEGUARD_SWITCHED_ON);
  }
  throw new Error(`Not mined within 2 minutes (${hash})`);
}

// Whether a signal of one of the account's rules was raised after the transaction was built, so it lacks a backup's
// signature that is now required.
async function safeguardSwitchedOn(network: Network, ctx: TransferContext): Promise<boolean> {
  const now = await signalStates(network).catch(() => ctx.signals);
  return raisedRules(ctx.account, now).length > raisedRules(ctx.account, ctx.signals).length;
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
    balance: state.balance,
    chainId: BigInt(chainId),
    nonce: BigInt(nonce),
    maxFeePerGas: 2n * BigInt(block.baseFeePerGas ?? "0x0") + TIP, // room for the base fee to double
    signals: state.signals,
  };
}
