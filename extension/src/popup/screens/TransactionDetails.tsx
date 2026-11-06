import { useEffect, useState } from "react";
import { IconCheck, IconCopy, IconLoader2, IconX } from "@tabler/icons-react";
import { Header } from "../components/Header";
import { SchemeChip } from "../components/SchemeChip";
import { shortAddress } from "../format";
import { TxHash } from "../components/TxHash";
import { SCHEME_INFO } from "../schemes";
import { kindOf } from "../transactions";
import { formatEth } from "../../wallet/account";
import { type HistoryEntry, loadHistory, syncHistory } from "../../wallet/history";
import { loadNetwork } from "../../wallet/network";
import "./TransactionDetails.css";

// One transaction from the account's history: what it did, its status, date, fee, the signatures it carried and
// its hash. While it is pending, its receipt is checked every 2 seconds.
export function TransactionDetails({ index, hash, onBack }: { index: number; hash: string; onBack: () => void }) {
  const [entry, setEntry] = useState<HistoryEntry>();
  const [copied, setCopied] = useState<boolean>();

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      const found = (await loadHistory(index)).find((e) => e.hash === hash);
      if (stopped) return;
      setEntry(found);
      if (found?.status !== "pending") return;
      const synced = await syncHistory(await loadNetwork(), index).catch(() => undefined);
      if (stopped) return;
      setEntry(synced?.find((e) => e.hash === hash) ?? found);
      timer = setTimeout(refresh, 2000);
    };
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [index, hash]);

  if (!entry) return null;
  const { title, Icon } = kindOf(entry);

  async function copy() {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="screen">
      <Header title="Transaction" onBack={onBack} />
      <div className="tx-hero">
        <span className="tx-icon">
          <Icon size={20} aria-hidden />
        </span>
        <span className="tx-kind">{title}</span>
        {entry.kind === "transfer" ? (
          <>
            <span className="tx-amount">{formatEth(BigInt(entry.value!))} ETH</span>
            <span className="tx-kind">
              to <span className="mono">{shortAddress(entry.to!)}</span>
            </span>
          </>
        ) : (
          <>
            <div className="chips" style={{ justifyContent: "center" }}>
              {entry.schemes!.map((s) => (
                <SchemeChip key={s} scheme={s} />
              ))}
            </div>
            {entry.rules && (
              <span className="tx-kind">
                Safeguards: {entry.rules.length === 0 ? "none" : entry.rules.map((s) => SCHEME_INFO[s].label).join(", ")}
              </span>
            )}
          </>
        )}
        <Status entry={entry} />
      </div>
      <div className="panel tx-facts">
        <div className="row tx-fact">
          <span>Date</span>
          <span>{new Date(entry.time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
        </div>
        <div className="row tx-fact">
          <span>Network fee</span>
          <span>{entry.fee ? `${formatEth(BigInt(entry.fee), 5)} ETH` : "—"}</span>
        </div>
      </div>
      <div>
        <p className="label">Signed with</p>
        <div className="chips">
          {entry.signers.map((s, i) => (
            <SchemeChip key={i} scheme={s} />
          ))}
        </div>
      </div>
      <div className="spacer">
        <p className="label">Transaction hash</p>
        <div className="row tx-hash">
          <TxHash hash={hash} full={copied === false} />
          <button className="icon-button" onClick={copy} aria-label="Copy transaction hash">
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function Status({ entry }: { entry: HistoryEntry }) {
  if (entry.status === "pending") {
    return (
      <span className="tx-pill">
        <IconLoader2 size={14} className="spin" aria-hidden /> Waiting for a block
      </span>
    );
  }
  if (entry.status === "dropped") {
    return (
      <span className="tx-pill tx-pill-failed">
        <IconX size={14} aria-hidden /> Dropped: a safeguard switched on
      </span>
    );
  }
  if (entry.status === "failed") {
    return (
      <span className="tx-pill tx-pill-failed">
        <IconX size={14} aria-hidden /> A frame failed · block {entry.block}
      </span>
    );
  }
  return (
    <span className="tx-pill tx-pill-done">
      <IconCheck size={14} aria-hidden /> Block {entry.block}
    </span>
  );
}
