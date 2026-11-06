import { RpcError } from "./rpc";
import { WrongPasswordError } from "./vault";

// A subscribed break signal was raised after the transaction was signed, so it lacks the backup's signature.
export const SAFEGUARD_SWITCHED_ON = "A safeguard just switched on, so this needs another signature. Send it again.";

// What went wrong, in a sentence for the popup. Known mempool refusals get their meaning; other node messages keep
// their text, without the RPC method.
export function explain(e: unknown): string {
  if (e instanceof WrongPasswordError) return "Wrong password. Try again.";
  if (!(e instanceof Error)) return String(e);
  if (!(e instanceof RpcError)) return e.message;
  const reason = e.reason;
  if (/exceeds MAX_VERIFY_GAS/.test(reason)) {
    return "The VPR mempool refused it: its signature checks need more gas than the mempool allows. Is the mempool node running the current VPR build?";
  }
  if (/cannot cover its pending/.test(reason)) return "Not enough ETH for the amount plus the network fee.";
  // The hashes are checked first, so too few signatures means a raised signal the transaction didn't sign for.
  if (/missing signature/.test(reason)) return SAFEGUARD_SWITCHED_ON;
  if (/wrong (schemes|rules)/.test(reason)) {
    return "The wallet's schemes or safeguards on chain aren't the ones saved here, so it can't sign for them.";
  }
  if (/nonce/i.test(reason)) return "Another transaction from this wallet is still pending. Wait for it to be mined, then try again.";
  return e.method === "eth_sendFrameTransaction" ? `The VPR mempool refused it: ${reason}` : reason;
}
