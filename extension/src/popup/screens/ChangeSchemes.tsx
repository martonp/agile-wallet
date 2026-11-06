import { useEffect, useState } from "react";
import { SchemeChip } from "../components/SchemeChip";
import { Header } from "../components/Header";
import { SendProgress, type Tracker } from "../components/SendProgress";
import { SCHEMES, SCHEME_INFO, type Scheme } from "../schemes";
import { type Account, accountState, loadAccount, syncAccount } from "../../wallet/account";
import { loadNetwork } from "../../wallet/network";
import { type Progress, changeSchemes, changeSchemesBeforeDeployment } from "../../wallet/transaction";
import { explain } from "../../wallet/errors";


export function ChangeSchemes({ index, onBack }: { index: number; onBack: () => void }) {
  const [account, setAccount] = useState<Account>();
  const [deployed, setDeployed] = useState<boolean>(); // undefined until known; before deployment, no transaction
  const [next, setNext] = useState<Scheme[]>([]);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [tracker, setTracker] = useState<Tracker>();
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const network = await loadNetwork();
      const loaded = await syncAccount(network, index).catch(() => loadAccount(index));
      setAccount(loaded);
      setNext(loaded?.schemes.map((s) => s.scheme) ?? []);
      if (loaded) setDeployed(await accountState(network, loaded).then((s) => s.deployed, () => undefined));
    })();
  }, []);

  const current = account?.schemes.map((s) => s.scheme) ?? [];
  const toggle = (s: Scheme) => setNext((n) => (n.includes(s) ? n.filter((x) => x !== s) : [...n, s]));
  const changed = SCHEMES.some((s) => current.includes(s) !== next.includes(s));
  // setSchemes needs signatures from every scheme on before or after the change.
  const signers = SCHEMES.filter((s) => current.includes(s) || next.includes(s));
  // Before deployment only an added scheme needs the password, to derive its public key.
  const adding = next.some((s) => !current.includes(s));
  const needsPassword = deployed !== false || adding;

  async function onProgress(progress: Progress) {
    switch (progress.type) {
      case "signers":
        return setTracker({ signers: progress.signers, ms: [], current: -1, phase: "signing" });
      case "signing":
        return setTracker((t) => t && { ...t, current: progress.index });
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
    if (deployed === false) return saveBeforeDeployment(account);
    try {
      const rules = (account.rules ?? []).map(({ signal, scheme }) => ({ signal, scheme }));
      const sent = await changeSchemes(password, account, { schemes: next, rules }, onProgress);
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
      setError(explain(e));
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  async function saveBeforeDeployment(account: Account) {
    try {
      const updated = await changeSchemesBeforeDeployment(password, account, next);
      setAccount(updated);
      setNext(updated.schemes.map((s) => s.scheme));
      setDone("Saved. Your first transaction deploys the wallet with these schemes.");
    } catch (e) {
      setError(explain(e));
      // Deployed from elsewhere meanwhile: from now on, a change takes a transaction.
      setDeployed(await accountState(await loadNetwork(), account).then((s) => s.deployed, () => deployed));
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
      ) : deployed === false ? (
        changed && (
          <p className="hint">
            This wallet isn't deployed yet, so the change is just saved here: no transaction, no fee. Your first
            transaction deploys it with these schemes.
          </p>
        )
      ) : (
        changed && (
          <div className="warning">
            This change is signed by every scheme that's on now or after it:{" "}
            {signers.map((s) => SCHEME_INFO[s].label).join(", ")}.
          </div>
        )
      )}
      <div className="spacer">
        {needsPassword && (
          <>
            <p className="label">Password</p>
            <input className="field" type="password" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} />
          </>
        )}
      </div>
      {error && <p className="error check-lines">{error}</p>}
      {done && <p className="hint">{done}</p>}
      <button
        className="btn btn-primary"
        disabled={busy || deployed === undefined || (needsPassword && !password) || !changed || next.length === 0}
        onClick={apply}
      >
        {busy ? "Applying…" : deployed === false ? "Save" : "Sign and apply"}
      </button>
    </div>
  );
}
