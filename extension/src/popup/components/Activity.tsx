import { IconChevronRight, IconLoader2, IconX } from "@tabler/icons-react";
import { kindOf } from "../transactions";
import { formatEth } from "../../wallet/account";
import type { HistoryEntry } from "../../wallet/history";
import "./Activity.css";

const SHOWN = 3;

// The account's latest transactions, one line each; a row opens the transaction's details.
export function Activity({ history, onOpen }: { history: HistoryEntry[]; onOpen: (hash: string) => void }) {
  if (history.length === 0) return null;
  return (
    <div>
      <p className="label">Activity</p>
      {history.slice(0, SHOWN).map((entry) => {
        const { title, Icon } = kindOf(entry);
        return (
          <button key={entry.hash} className="activity-row" onClick={() => onOpen(entry.hash)}>
            <span className="activity-what">
              <Icon size={15} aria-hidden />
              {entry.kind === "transfer" ? `${title} · ${formatEth(BigInt(entry.value!))} ETH` : title}
            </span>
            <span className={`status status-${entry.status === "failed" ? "failed" : entry.status === "pending" ? "active" : "done"}`}>
              {entry.status === "pending" && <IconLoader2 size={14} className="spin" aria-hidden />}
              {entry.status === "failed" && <IconX size={14} aria-hidden />}
              {entry.status === "pending" ? "pending" : `#${entry.block}`}
              <IconChevronRight size={14} aria-hidden />
            </span>
          </button>
        );
      })}
    </div>
  );
}
