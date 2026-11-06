import { useEffect, useState } from "react";
import { SchemeChip } from "../components/SchemeChip";
import { Header } from "../components/Header";
import { SendProgress, type Tracker } from "../components/SendProgress";
import { SCHEMES, SCHEME_INFO, type Scheme } from "../schemes";
import { type Account, loadAccount, syncAccount } from "../../wallet/account";
import { loadNetwork } from "../../wallet/network";
import { type Progress, changeSchemes } from "../../wallet/transaction";
import { WrongPasswordError } from "../../wallet/vault";

// Resolves once the browser has painted: a signer then blocks the thread only after its "signing…" is on screen.
const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

export function ChangeSchemes({ index, onBack }: { index: number; onBack: () => void }) {
  const [account, setAccount] = useState<Account>();
  const [next, setNext] = useState<Scheme[]>([]);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [tracker, setTracker] = useState<Tracker>();
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const loaded = await syncAccount(await loadNetwork(), index).catch(() => loadAccount(index));
      setAccount(loaded);
      setNext(loaded?.schemes.map((s) => s.scheme) ?? []);
    })();
  }, []);

  const current = account?.schemes.map((s) => s.scheme) ?? [];
  const toggle = (s: Scheme) => setNext((n) => (n.includes(s) ? n.filter((x) => x !== s) : [...n, s]));
  const changed = SCHEMES.some((s) => current.includes(s) !== next.includes(s));
  // setSchemes needs signatures from every scheme on before or after the change.
  const signers = SCHEMES.filter((s) => current.includes(s) || next.includes(s));

  async function onProgress(progress: Progress) {
    switch (progress.type) {
      case "signers":
        return setTracker({ signers: progress.signers, ms: [], current: -1, phase: "signing" });
      case "signing":
        setTracker((t) => t && { ...t, current: progress.index });
        return nextPaint();
      case "signed":
        return setTracker((t) => t && { ...t, ms: Object.assign([...t.ms], { [progress.index]: progress.ms }) });
      case "sending":
      case "mining":
        return setTracker((t) => t && { ...t, phase: progress.type });
    }
  }

  async function apply() {
    if (!account) return;
    setError("");
    setDone("");
    setTracker(undefined);
    setBusy(true);
    try {
      const sent = await changeSchemes(password, account, next, onProgress);
      setTracker((t) => t && { ...t, phase: "done", block: sent.block, ok: sent.ok });
      if (sent.ok) {
        const updated = await loadAccount(index);
        setAccount(updated);
        setNext(updated?.schemes.map((s) => s.scheme) ?? []);
        setDone(`Every transaction now needs ${next.length === 1 ? "this signature" : "these signatures"}.`);
      } else {
        setError("The change was mined but failed, so the schemes stay as they were.");
      }
    } catch (e) {
      setTracker((t) => t && { ...t, failed: true });
      setError(e instanceof WrongPasswordError ? "Wrong password. Try again." : e instanceof Error ? e.message : String(e));
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <Header title="Change schemes" onBack={onBack} />
      <p className="hint">Choose which signatures every transaction needs.</p>
      <div>
        {SCHEMES.map((s) => (
          <label key={s} className="toggle-row">
            <SchemeChip scheme={s} />
            <input type="checkbox" className="switch" checked={next.includes(s)} disabled={busy} onChange={() => toggle(s)} />
          </label>
        ))}
      </div>
      {tracker ? (
        <SendProgress tracker={tracker} />
      ) : next.length === 0 ? (
        <p className="error">Keep at least one scheme.</p>
      ) : (
        changed && (
          <div className="warning">
            This change is signed by every scheme that's on now or after it:{" "}
            {signers.map((s) => SCHEME_INFO[s].label).join(", ")}.
          </div>
        )
      )}
      <div className="spacer">
        <p className="label">Password</p>
        <input className="field" type="password" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p className="error check-lines">{error}</p>}
      {done && <p className="hint">{done}</p>}
      <button className="btn btn-primary" disabled={busy || !password || !changed || next.length === 0} onClick={apply}>
        {busy ? "Applying…" : "Sign and apply"}
      </button>
    </div>
  );
}
