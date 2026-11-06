import type { Network } from "./network";
import { rpc } from "./rpc";
import type { Scheme } from "./schemes";

// What the wallet sent, per account, newest first. An entry is written as pending once the mempool accepts the
// transaction and settled from its receipt, by the send itself or, if its popup closed first, by syncHistory.
export interface HistoryEntry {
  hash: string;
  time: number; // ms since the epoch, when sent
  kind: "transfer" | "setSchemes";
  to?: string; // a transfer's recipient
  value?: string; // a transfer's amount, in wei (bigint as a string: storage is JSON)
  schemes?: Scheme[]; // a scheme change's new list
  deploys: boolean; // the wallet's first transaction, which also deploys it
  signatures: { scheme: Scheme; ms: number }[];
  status: "pending" | "mined" | "failed";
  block?: number;
}

const MAX_ENTRIES = 50;
const keyOf = (index: number) => (index === 0 ? "history" : `history:${index}`);

export async function loadHistory(index: number): Promise<HistoryEntry[]> {
  return ((await chrome.storage.local.get(keyOf(index)))[keyOf(index)] as HistoryEntry[] | undefined) ?? [];
}

async function saveHistory(index: number, entries: HistoryEntry[]): Promise<void> {
  await chrome.storage.local.set({ [keyOf(index)]: entries.slice(0, MAX_ENTRIES) });
}

export async function addEntry(index: number, entry: HistoryEntry): Promise<void> {
  await saveHistory(index, [entry, ...(await loadHistory(index)).filter((e) => e.hash !== entry.hash)]);
}

export async function settleEntry(index: number, hash: string, ok: boolean, block: number): Promise<void> {
  const entries = await loadHistory(index);
  await saveHistory(
    index,
    entries.map((e) => (e.hash === hash ? { ...e, status: ok ? "mined" : "failed", block } : e)),
  );
}

// The history, after settling pending entries whose receipts the node now has.
export async function syncHistory(network: Network, index: number): Promise<HistoryEntry[]> {
  const entries = await loadHistory(index);
  const pending = entries.filter((e) => e.status === "pending");
  if (pending.length === 0) return entries;
  for (const entry of pending) {
    const receipt = await rpc<Receipt | null>(network.rpcUrl, "eth_getTransactionReceipt", [entry.hash]);
    if (receipt) await settleEntry(index, entry.hash, receiptOk(receipt), Number(BigInt(receipt.blockNumber)));
  }
  return loadHistory(index);
}

export interface Receipt {
  status?: string;
  blockNumber: string;
  frameReceipts?: { status: string }[];
}

// Every frame succeeded (a frame transaction's receipt reports each).
export function receiptOk(receipt: Receipt): boolean {
  return receipt.frameReceipts ? receipt.frameReceipts.every((f) => f.status === "0x1") : receipt.status === "0x1";
}
