import type { ReactNode } from "react";
import { Header } from "./Header";
import { SendProgress, type Tracker } from "./SendProgress";
import { shortAddress } from "../format";
import type { Sent } from "../../wallet/transaction";

// The screen a transaction is signed and sent on: what it does, each signature as it is made, the mempool and the
// block, then a way back to the account. On an error, Edit returns to the form, unless the transaction already
// reached the mempool or was mined, where sending it again could do it twice. `retryFailed` also offers Edit when it
// was mined but a frame failed, for transactions that are safe to send again.
export function Submission({
  title,
  busyTitle,
  summary,
  tracker,
  busy,
  sent,
  label,
  note,
  failed,
  retryFailed = false,
  error,
  onEdit,
  onDone,
}: {
  title: string;
  busyTitle: string; // while signing and sending
  summary: ReactNode; // what the transaction does
  tracker: Tracker | undefined;
  busy: boolean;
  sent: Sent | undefined;
  label: string; // what a mined transaction did: "Sent", "Applied"…
  note?: string; // shown once it is mined
  failed?: string; // shown when it was mined but a frame failed
  retryFailed?: boolean;
  error: string;
  onEdit: () => void;
  onDone: () => void;
}) {
  const pending = !!error && (tracker?.phase === "mining" || !!sent);
  const editable = (!!error && !pending) || (retryFailed && sent !== undefined && !sent.ok);
  return (
    <div className="screen">
      <Header title={busy ? busyTitle : title} onBack={busy ? undefined : onDone} />
      <div className="panel">{summary}</div>
      {tracker ? <SendProgress tracker={tracker} /> : busy && <p className="hint">Preparing the keys…</p>}
      {sent && (
        <p className={sent.ok ? "hint" : "error"}>
          {sent.ok ? label : "Mined, but a frame failed"} in block {sent.block.toString()}:{" "}
          <span className="mono">{shortAddress(sent.hash)}</span>
        </p>
      )}
      {sent && (sent.ok ? note : failed) && <p className={sent.ok ? "hint" : "error"}>{sent.ok ? note : failed}</p>}
      {error && (
        <p className="error check-lines">
          {error}
          {pending && " It may still be mined: its entry in Activity will show."}
        </p>
      )}
      <div className="row spacer">
        {editable && (
          <button className="btn btn-secondary" onClick={onEdit}>
            Edit
          </button>
        )}
        <button className="btn btn-primary" disabled={busy} onClick={onDone}>
          {busy ? `${busyTitle}…` : "Back to account"}
        </button>
      </div>
    </div>
  );
}
