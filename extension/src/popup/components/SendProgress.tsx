import type { ReactNode } from "react";
import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { SchemeChip } from "./SchemeChip";
import type { Signer } from "../../wallet/transaction";

export type Phase = "signing" | "sending" | "mining" | "done";

// Where a send is: every signature's time once signed, the one being signed, then the mempool and the block.
export interface Tracker {
  signers: Signer[];
  ms: (number | undefined)[];
  current: number; // the signature being signed
  phase: Phase;
  failed?: boolean; // the step `phase` points at failed
  block?: bigint;
  ok?: boolean; // every frame of the mined transaction succeeded
}

export function SendProgress({ tracker }: { tracker: Tracker }) {
  const { signers, ms, current, phase, failed, block, ok } = tracker;
  const after = (p: Phase) => ["signing", "sending", "mining", "done"].indexOf(phase) > ["signing", "sending", "mining", "done"].indexOf(p);
  return (
    <div className="panel">
      <p className="label">Signatures</p>
      {signers.map((signer, i) => (
        <div key={i} className="progress-row">
          <span className="row" style={{ alignItems: "center" }}>
            <SchemeChip scheme={signer.scheme} />
            {signer.owner && <span className="hint">owner, deploys the wallet</span>}
          </span>
          {ms[i] !== undefined ? (
            <Status icon="done">{formatMs(ms[i]!)}</Status>
          ) : i === current && phase === "signing" ? (
            failed ? <Status icon="failed">failed</Status> : <Status icon="active">signing…</Status>
          ) : (
            <Status>waiting</Status>
          )}
        </div>
      ))}
      <div className="progress-row" style={{ marginTop: 6 }}>
        <span>Mempool</span>
        {phase === "sending" ? (
          failed ? <Status icon="failed">rejected</Status> : <Status icon="active">sending…</Status>
        ) : after("sending") ? (
          <Status icon="done">accepted</Status>
        ) : (
          <Status>waiting</Status>
        )}
      </div>
      <div className="progress-row">
        <span>Block</span>
        {phase === "mining" ? (
          failed ? <Status icon="failed">not mined</Status> : <Status icon="active">waiting for a block…</Status>
        ) : phase === "done" ? (
          <Status icon={ok ? "done" : "failed"}>{ok ? `#${block}` : `#${block}, a frame failed`}</Status>
        ) : (
          <Status>waiting</Status>
        )}
      </div>
    </div>
  );
}

function Status({ icon, children }: { icon?: "active" | "done" | "failed"; children: ReactNode }) {
  return (
    <span className={`status ${icon ? `status-${icon}` : ""}`}>
      {icon === "active" && <IconLoader2 size={14} className="spin" aria-hidden />}
      {icon === "done" && <IconCheck size={14} aria-hidden />}
      {icon === "failed" && <IconX size={14} aria-hidden />}
      {children}
    </span>
  );
}

function formatMs(ms: number): string {
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
