import { getProfile } from "@forshtat/hegota-support/profiles";
import { toWire } from "@forshtat/hegota-support/rpc";
import * as tx from "@forshtat/hegota-support/tx";
import type { FrameTx, SignatureEntry } from "@forshtat/hegota-support/tx";
import { type Address, type Hex, bytesToHex, encodeFunctionData, hexToBytes, zeroAddress } from "viem";
import { type Account, accountState } from "./account";
import type { SigningKeys } from "./derive";
import { ecdsaSign } from "./ecdsa";
import { falconSign } from "./falcon";
import { withSigningKeys } from "./keyring";
import { CONTRACTS, type Network, loadNetwork } from "./network";
import { rpc } from "./rpc";
import type { Scheme } from "./schemes";
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

// ECDSA is native: no verifier contract, a protocol SECP256K1 signature entry instead.
const VERIFIERS: Record<Scheme, Address> = {
  ecdsa: zeroAddress,
  falcon: CONTRACTS.falconVerifier as Address,
  sphincs: CONTRACTS.sphincsVerifier as Address,
};

export interface Transfer {
  to: Address;
  value: bigint; // wei
}

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

// The first transaction also deploys the wallet: a DEFAULT frame calls the factory, and the owner's SECP256K1
// entry authorises it (an ECDSA scheme's entry, by the owner, does that too).
export function buildTransfer(ctx: TransferContext, transfer: Transfer, limits: Limits): FrameTx {
  const schemes = ctx.account.schemes.map((s) => ({ verifier: VERIFIERS[s.scheme], publicKey: s.publicKey as Hex }));
  const owner = ctx.account.owner as Address;
  const frames = [];
  if (!ctx.deployed) {
    const data = encodeFunctionData({ abi: FACTORY_ABI, functionName: "deploy", args: [owner, schemes] });
    frames.push(tx.frame(PROFILE, "DEFAULT", { target: CONTRACTS.factory as Address, execution: limits.deploy, state: 300_000n, data }));
  }
  const validate = encodeFunctionData({ abi: WALLET_ABI, functionName: "validate", args: [schemes] });
  frames.push(tx.frame(PROFILE, "VERIFY", { scope: "EXECUTION_AND_PAYMENT", execution: limits.verify, data: validate }));
  // State gas covers creating the recipient's account if it is new.
  frames.push(tx.frame(PROFILE, "SENDER", { target: transfer.to, execution: 50_000n, state: 200_000n, value: transfer.value }));

  const signatures: SignatureEntry[] = ctx.account.schemes.map((s) =>
    s.scheme === "ecdsa"
      ? tx.secp256k1Placeholder(PROFILE, owner)
      : { scheme: tx.sigScheme(PROFILE, "ARBITRARY"), signer: "0x", msg: "0x", signature: "0x" },
  );
  if (!ctx.deployed && !hasEcdsa(ctx.account)) signatures.push(tx.secp256k1Placeholder(PROFILE, owner));

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

export function fixedLimits(account: Account, deployed: boolean): Limits {
  const sum = (table: Record<Scheme | "base", bigint>) => account.schemes.reduce((g, s) => g + table[s.scheme], table.base);
  return { deploy: deployed ? 0n : sum(DEPLOY_GAS), verify: sum(VERIFY_GAS) };
}

// Signs every entry over the canonical sig hash: one per scheme, then the owner's if there is one more.
export async function signTransfer(unsigned: FrameTx, account: Account, keys: SigningKeys): Promise<FrameTx> {
  const digest = hexToBytes(tx.sigHash(PROFILE, unsigned));
  const signatures: SignatureEntry[] = [];
  for (let i = 0; i < unsigned.signatures.length; i++) {
    const scheme: Scheme = account.schemes[i]?.scheme ?? "ecdsa"; // past the schemes: the owner's entry
    signatures.push({ ...unsigned.signatures[i], signature: bytesToHex(await signWith(scheme, keys, digest)) });
  }
  return { ...unsigned, signatures };
}

async function signWith(scheme: Scheme, keys: SigningKeys, digest: Uint8Array): Promise<Uint8Array> {
  if (scheme === "ecdsa") return ecdsaSign(keys.ecdsa!, digest);
  if (scheme === "falcon") return falconSign(keys.falcon!, digest);
  return sphincsSign(keys.sphincs!, digest);
}

export type Step = "signing" | "sending" | "mining";

export interface Sent {
  hash: Hex;
  block: bigint;
  ok: boolean; // every frame succeeded
}

// Signs a transfer once with the account's keys, at fixed gas limits, and sends it through the VPR mempool, which
// simulates it before accepting it.
export async function sendTransfer(
  password: string,
  account: Account,
  transfer: Transfer,
  onStep: (step: Step) => void = () => {},
): Promise<Sent> {
  const network = await loadNetwork();
  const ctx = await transferContext(network, account);
  const needed: Scheme[] = [...account.schemes.map((s) => s.scheme), ...(ctx.deployed ? [] : ["ecdsa" as const])];

  onStep("signing");
  const unsigned = buildTransfer(ctx, transfer, fixedLimits(account, ctx.deployed));
  const signed = await withSigningKeys(password, needed, (keys) => signTransfer(unsigned, account, keys));

  onStep("sending");
  const hash = tx.txHash(PROFILE, signed);
  await rpc(network.sidecarUrl, "eth_sendFrameTransaction", [toWire(signed)]);

  onStep("mining");
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

function hasEcdsa(account: Account): boolean {
  return account.schemes.some((s) => s.scheme === "ecdsa");
}
