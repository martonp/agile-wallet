import { useState } from "react";
import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { shortAddress } from "../format";
import { SCHEME_INFO } from "../schemes";
import { formatEth } from "../../wallet/account";
import type { HistoryEntry } from "../../wallet/history";
import "./Activity.css";

const SHOWN = 3;

// The account's latest transactions, one line each; a click shows what signed it and how long each signature took.
export function Activity({ history }: { history: HistoryEntry[] }) {
  const [open, setOpen] = useState<string>();
  if (history.length === 0) return null;
  return (
    <div>
      <p className="label">Activity</p>
      {history.slice(0, SHOWN).map((entry) => (
        <button key={entry.hash} className="activity-row" onClick={() => setOpen(open === entry.hash ? undefined : entry.hash)}>
          <span className="activity-line">
            <span>{describe(entry)}</span>
            <span className={`status status-${entry.status === "pending" ? "active" : entry.status === "mined" ? "done" : "failed"}`}>
              {entry.status === "pending" && <IconLoader2 size={14} className="spin" aria-hidden />}
              {entry.status === "mined" && <IconCheck size={14} aria-hidden />}
              {entry.status === "failed" && <IconX size={14} aria-hidden />}
              {entry.status === "pending" ? "pending" : `#${entry.block}`}
            </span>
          </span>
          {open === entry.hash && (
            <span className="hint activity-detail">
              {entry.deploys && "Also deployed the wallet. "}
              Signed with {entry.signatures.map((s) => `${SCHEME_INFO[s.scheme].label} ${formatMs(s.ms)}`).join(" · ")}
              {entry.status === "failed" && ". A frame failed, so nothing changed."}
              <span className="mono activity-hash">{entry.hash}</span>
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function describe(entry: HistoryEntry): string {
  if (entry.kind === "setSchemes") return `Schemes: ${entry.schemes!.map((s) => SCHEME_INFO[s].label).join(", ")}`;
  return `Sent ${formatEth(BigInt(entry.value!))} ETH to ${shortAddress(entry.to!)}`;
}

function formatMs(ms: number): string {
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
