import type { Network } from "./network";
import { rpc } from "./rpc";
import type { Scheme } from "./schemes";

// What the wallet sent, per account, newest first. An entry is written as pending once the mempool accepts the
// transaction and settled from its receipt, by the send itself or, if its popup closed first, by syncHistory.
export interface HistoryEntry {
  hash: string;
  time: number; // ms since the epoch, when sent
  kind: "transfer" | "setSchemes" | "deploy"; // deploy: a first transaction that only deploys the wallet
  to?: string; // a transfer's recipient
  value?: string; // a transfer's amount, in wei (bigint as a string: storage is JSON)
  schemes?: Scheme[]; // a scheme change's new list, or the deployed wallet's
  rules?: Scheme[]; // and the backup scheme of each of its rules
  deploys: boolean; // the wallet's first transaction, which also deploys it
  signers: Scheme[]; // the scheme of each signature the transaction carried, in order
  status: "pending" | "mined" | "failed" | "dropped"; // dropped: the mempool let it go without mining it
  block?: number;
  fee?: string; // what it paid, in wei: gas used times the effective gas price (bigint as a string)
}

const MAX_ENTRIES = 50;
const keyOf = (index: number) => (index === 0 ? "history" : `history:${index}`);

export async function loadHistory(index: number): Promise<HistoryEntry[]> {
  const stored = ((await chrome.storage.local.get(keyOf(index)))[keyOf(index)] as Stored[] | undefined) ?? [];
  // Entries from before `signers` kept each signature's scheme with its signing time.
  return stored.map(({ signatures, ...entry }) => ({ ...entry, signers: entry.signers ?? signatures?.map((s) => s.scheme) ?? [] }));
}

type Stored = Omit<HistoryEntry, "signers"> & { signers?: Scheme[]; signatures?: { scheme: Scheme }[] };

async function saveHistory(index: number, entries: HistoryEntry[]): Promise<void> {
  await chrome.storage.local.set({ [keyOf(index)]: entries.slice(0, MAX_ENTRIES) });
}

export async function addEntry(index: number, entry: HistoryEntry): Promise<void> {
  await saveHistory(index, [entry, ...(await loadHistory(index)).filter((e) => e.hash !== entry.hash)]);
}

// Marks the entry mined or failed from its receipt, with its block and the fee it paid.
export async function settleEntry(index: number, hash: string, receipt: Receipt): Promise<void> {
  const entries = await loadHistory(index);
  const settled = {
    status: receiptOk(receipt) ? ("mined" as const) : ("failed" as const),
    block: Number(BigInt(receipt.blockNumber)),
    fee: receipt.gasUsed && receipt.effectiveGasPrice ? (BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)).toString() : undefined,
  };
  await saveHistory(index, entries.map((e) => (e.hash === hash ? { ...e, ...settled } : e)));
}

// Marks a pending entry dropped: the mempool evicted it, so it will never be mined.
export async function dropEntry(index: number, hash: string): Promise<void> {
  const entries = await loadHistory(index);
  await saveHistory(index, entries.map((e) => (e.hash === hash && e.status === "pending" ? { ...e, status: "dropped" as const } : e)));
}

// The history, after settling pending entries whose receipts the node now has, and filling in the fee of entries
// settled before fees were recorded.
export async function syncHistory(network: Network, index: number): Promise<HistoryEntry[]> {
  const entries = await loadHistory(index);
  const unsettled = entries.filter((e) => e.status === "pending" || (e.status !== "dropped" && e.fee === undefined));
  if (unsettled.length === 0) return entries;
  for (const entry of unsettled) {
    const receipt = await rpc<Receipt | null>(network.url, "eth_getTransactionReceipt", [entry.hash]);
    if (receipt) await settleEntry(index, entry.hash, receipt);
  }
  return loadHistory(index);
}

export interface Receipt {
  status?: string;
  blockNumber: string;
  gasUsed?: string;
  effectiveGasPrice?: string;
  frameReceipts?: { status: string }[];
}

// Every frame succeeded (a frame transaction's receipt reports each).
export function receiptOk(receipt: Receipt): boolean {
  return receipt.frameReceipts ? receipt.frameReceipts.every((f) => f.status === "0x1") : receipt.status === "0x1";
}
