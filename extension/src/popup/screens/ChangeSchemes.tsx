import { useEffect, useState } from "react";
import { SchemeChip } from "../components/SchemeChip";
import { Header } from "../components/Header";
import { SendProgress, type Tracker } from "../components/SendProgress";
import { SCHEMES, SCHEME_INFO, type Scheme } from "../schemes";
import { type Account, type SignalStates, accountState, loadAccount, raisedRules, syncAccount } from "../../wallet/account";
import { SIGNALS, loadNetwork } from "../../wallet/network";
import { type Progress, type RuleChoice, changeSchemes, changeSchemesBeforeDeployment } from "../../wallet/transaction";
import { explain } from "../../wallet/errors";

// Each known signal's chosen backup scheme, or null when its safeguard is off, by lowercase signal address.
type Safeguards = Record<string, Scheme | null>;

const safeguardsOf = (account: Account | undefined): Safeguards =>
  Object.fromEntries(
    SIGNALS.map((s) => [s.address.toLowerCase(), account?.rules?.find((r) => r.signal.toLowerCase() === s.address.toLowerCase())?.scheme ?? null]),
  );

export function ChangeSchemes({ index, onBack }: { index: number; onBack: () => void }) {
  const [account, setAccount] = useState<Account>();
  const [deployed, setDeployed] = useState<boolean>(); // undefined until known; before deployment, no transaction
  const [signals, setSignals] = useState<SignalStates>({});
  const [next, setNext] = useState<Scheme[]>([]);
  const [nextSafeguards, setNextSafeguards] = useState<Safeguards>(safeguardsOf(undefined));
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [tracker, setTracker] = useState<Tracker>();
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  function show(loaded: Account | undefined) {
    setAccount(loaded);
    setNext(loaded?.schemes.map((s) => s.scheme) ?? []);
    setNextSafeguards(safeguardsOf(loaded));
  }

  useEffect(() => {
    (async () => {
      const network = await loadNetwork();
      const loaded = await syncAccount(network, index).catch(() => loadAccount(index));
      show(loaded);
      if (!loaded) return;
      const state = await accountState(network, loaded).catch(() => undefined);
      setDeployed(state?.deployed);
      setSignals(state?.signals ?? {});
    })();
  }, []);

  const current = account?.schemes.map((s) => s.scheme) ?? [];
  const toggle = (s: Scheme) => setNext((n) => (n.includes(s) ? n.filter((x) => x !== s) : [...n, s]));
  const schemesChanged = SCHEMES.some((s) => current.includes(s) !== next.includes(s));
  const safeguards = safeguardsOf(account);
  const safeguardsChanged = SIGNALS.some((s) => safeguards[s.address.toLowerCase()] !== nextSafeguards[s.address.toLowerCase()]);
  const changed = schemesChanged || safeguardsChanged;
  const rules: RuleChoice[] = SIGNALS.flatMap((s) => {
    const backup = nextSafeguards[s.address.toLowerCase()];
    return backup ? [{ signal: s.address, scheme: backup }] : [];
  });
  // The change needs signatures from every scheme on before or after it, from the backups of raised safeguards,
  // and from the backup of every safeguard set by it.
  const raised = account ? raisedRules(account, signals).map((r) => r.scheme) : [];
  const signers = SCHEMES.filter(
    (s) =>
      current.includes(s) ||
      raised.includes(s) ||
      (schemesChanged && next.includes(s)) ||
      (safeguardsChanged && rules.some((r) => r.scheme === s)),
  );
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
      const sent = await changeSchemes(password, account, { schemes: next, rules }, onProgress);
      setTracker((t) => t && { ...t, phase: "done", block: sent.block, ok: sent.ok });
      if (sent.ok) {
        show(await loadAccount(index));
        setDone(
          safeguardsChanged && !schemesChanged
            ? "Saved. The safeguard applies from now on."
            : `Every transaction now needs ${next.length === 1 ? "this signature" : "these signatures"}.`,
        );
      } else {
        setError("The change was mined but failed, so the schemes and safeguards stay as they were.");
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
      show(updated);
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
      <div>
        <p className="label">Safeguards</p>
        {SIGNALS.map((s) => {
          const key = s.address.toLowerCase();
          const backup = nextSafeguards[key];
          const choices = SCHEMES.filter((c) => c !== s.breaks);
          // The saved backup, or else one that isn't a scheme already (a backup that is adds nothing).
          const fallback = safeguards[key] ?? choices.find((c) => !current.includes(c)) ?? choices[choices.length - 1];
          const brokenAt = signals[key] ?? 0;
          const set = (scheme: Scheme | null) => setNextSafeguards((g) => ({ ...g, [key]: scheme }));
          return (
            <div key={key} className="safeguard">
              <div className="toggle-row">
                <span>
                  {s.label}? Also require{" "}
                  <select
                    className="select"
                    aria-label="Backup scheme"
                    value={backup ?? fallback}
                    disabled={busy || !deployed || backup === null}
                    onChange={(e) => set(e.target.value as Scheme)}
                  >
                    {choices.map((c) => (
                      <option key={c} value={c}>
                        {SCHEME_INFO[c].label}
                      </option>
                    ))}
                  </select>
                </span>
                <input
                  type="checkbox"
                  className="switch"
                  checked={backup !== null}
                  disabled={busy || !deployed}
                  onChange={() => set(backup === null ? fallback : null)}
                  aria-label={`Require a backup if ${s.label}`}
                />
              </div>
              <p className="hint">
                {deployed === undefined
                  ? ""
                  : deployed === false
                  ? "Available after your first transaction."
                  : brokenAt === 0
                    ? "Not signalled."
                    : `Signalled ${new Date(brokenAt * 1000).toLocaleDateString(undefined, { dateStyle: "medium" })}` +
                      (safeguards[key] ? ` · ${SCHEME_INFO[safeguards[key]!].label} now required.` : ".")}
              </p>
            </div>
          );
        })}
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
            This change is signed by {signers.map((s) => SCHEME_INFO[s].label).join(", ")}: every scheme that's on now
            or after it, and the backup of every safeguard that's raised or being set.
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
