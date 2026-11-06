import { useEffect, useState } from "react";
import { Header } from "../components/Header";
import { type Safeguards, SchemeChoices, choicesChanged, ruleChoices, safeguardsChanged, safeguardsOf } from "../components/SchemeChoices";
import { SendProgress, type Tracker } from "../components/SendProgress";
import { SCHEMES, SCHEME_INFO, type Scheme } from "../schemes";
import { type Account, type SignalStates, accountState, formatEth, loadAccount, raisedRules, syncAccount } from "../../wallet/account";
import { loadNetwork } from "../../wallet/network";
import { type Progress, changeSchemes, changeSchemesBeforeDeployment, deployFee, deployWallet } from "../../wallet/transaction";
import { explain } from "../../wallet/errors";

// A deployed wallet's schemes and safeguards change with a transaction. Before deployment this is the wallet's
// setup: the choice is saved for the first transaction, or the wallet is deployed with it right away.
export function ChangeSchemes({ index, onBack }: { index: number; onBack: () => void }) {
  const [account, setAccount] = useState<Account>();
  const [deployed, setDeployed] = useState<boolean>(); // undefined until known
  const [signals, setSignals] = useState<SignalStates>({});
  const [next, setNext] = useState<Scheme[]>([]);
  const [nextSafeguards, setNextSafeguards] = useState<Safeguards>(safeguardsOf(undefined));
  const [funds, setFunds] = useState<{ maxFee: bigint; balance: bigint }>(); // before deployment: the deploy fee
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "deploy" | "apply">(""); // what's running
  const [tracker, setTracker] = useState<Tracker>();
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  function show(loaded: Account | undefined) {
    setAccount(loaded);
    setNext(loaded?.schemes.map((s) => s.scheme) ?? []);
    setNextSafeguards(safeguardsOf(loaded));
  }

  async function refresh(loaded: Account) {
    const state = await accountState(await loadNetwork(), loaded).catch(() => undefined);
    setDeployed(state?.deployed);
    setSignals(state?.signals ?? {});
    if (state && !state.deployed) setFunds(await deployFee(loaded).catch(() => undefined));
  }

  useEffect(() => {
    (async () => {
      const loaded = await syncAccount(await loadNetwork(), index).catch(() => loadAccount(index));
      show(loaded);
      if (loaded) await refresh(loaded);
    })();
  }, []);

  const current = account?.schemes.map((s) => s.scheme) ?? [];
  const schemesChanged = SCHEMES.some((s) => current.includes(s) !== next.includes(s));
  const changed = choicesChanged(account, next, nextSafeguards);
  const rulesChanged = safeguardsChanged(account, nextSafeguards);
  const rules = ruleChoices(nextSafeguards);
  // A change needs signatures from every scheme on before or after it, from the backups of raised safeguards, and
  // from the backup of every safeguard set by it.
  const raised = account ? raisedRules(account, signals).map((r) => r.scheme) : [];
  const signers = SCHEMES.filter(
    (s) => current.includes(s) || raised.includes(s) || (schemesChanged && next.includes(s)) || (rulesChanged && rules.some((r) => r.scheme === s)),
  );
  // Before deployment, saving needs the password only to derive a new key; deploying always needs it.
  const known = [...current, ...(account?.rules ?? []).map((r) => r.scheme)];
  const adding = [...next, ...rules.map((r) => r.scheme)].some((s) => !known.includes(s));
  const canDeploy = funds !== undefined && funds.balance >= funds.maxFee;

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

  // Runs `work` with the busy state, the progress and the error shown, and the password cleared after.
  async function run(kind: "save" | "deploy" | "apply", work: () => Promise<void>) {
    setError("");
    setDone("");
    setTracker(undefined);
    setBusy(kind);
    try {
      await work();
    } catch (e) {
      setTracker((t) => t && { ...t, failed: true });
      setError(explain(e));
      // The choice may have been saved before the failure, or the wallet deployed from elsewhere meanwhile.
      const latest = await loadAccount(index);
      if (latest && deployed === false) await refresh(latest);
    } finally {
      setPassword("");
      setBusy("");
    }
  }

  const apply = () =>
    run("apply", async () => {
      const sent = await changeSchemes(password, account!, { schemes: next, rules }, onProgress);
      setTracker((t) => t && { ...t, phase: "done", block: sent.block, ok: sent.ok });
      if (!sent.ok) return setError("The change was mined but failed, so the schemes and safeguards stay as they were.");
      show(await loadAccount(index));
      setDone(
        rulesChanged && !schemesChanged
          ? "Saved. The safeguard applies from now on."
          : `Every transaction now needs ${next.length === 1 ? "this signature" : "these signatures"}.`,
      );
    });

  // Before deployment: keeps the choice for the first transaction. Returns the account as saved.
  async function saveChoice(): Promise<Account> {
    const updated = changed ? await changeSchemesBeforeDeployment(password, account!, { schemes: next, rules }) : account!;
    show(updated);
    setFunds(await deployFee(updated).catch(() => undefined));
    return updated;
  }

  const save = () =>
    run("save", async () => {
      await saveChoice();
      setDone("Saved. Your first transaction deploys the wallet with these.");
    });

  const deploy = () =>
    run("deploy", async () => {
      const sent = await deployWallet(password, await saveChoice(), onProgress);
      setTracker((t) => t && { ...t, phase: "done", block: sent.block, ok: sent.ok });
      // Deployed either way: the screen becomes Change Schemes.
      const loaded = await loadAccount(index);
      show(loaded);
      if (loaded) await refresh(loaded);
      if (!sent.ok) return setError("The wallet was deployed, but setting its safeguards failed.");
      setDone(`Deployed in block ${sent.block}.`);
    });

  const setup = deployed === false;
  const funded = funds !== undefined && funds.balance > 0n;
  return (
    <div className="screen">
      <Header title={deployed === undefined ? "Schemes" : setup ? "Set up your wallet" : "Change schemes"} onBack={onBack} />
      <p className="hint">
        {setup
          ? "Choose the signatures every transaction needs, and the safeguards. Your wallet is deployed with these."
          : "Choose which signatures every transaction needs."}
      </p>
      <SchemeChoices
        account={account}
        schemes={next}
        onSchemes={setNext}
        safeguards={nextSafeguards}
        onSafeguards={setNextSafeguards}
        signals={signals}
        deployed={deployed}
        disabled={busy !== ""}
      />
      {tracker ? (
        <SendProgress tracker={tracker} />
      ) : next.length === 0 ? (
        <p className="error">Keep at least one scheme.</p>
      ) : setup ? (
        <div className="panel">
          <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: "var(--muted)" }}>Deployment fee</span>
            <span>{changed ? "shown once saved" : funds ? `up to ${formatEth(funds.maxFee, 5)} ETH` : "—"}</span>
          </div>
          {funds && !changed && !canDeploy && <p className="hint" style={{ marginTop: 6 }}>Add ETH to pay the deployment fee first.</p>}
        </div>
      ) : (
        changed && (
          <div className="warning">
            This change is signed by {signers.map((s) => SCHEME_INFO[s].label).join(", ")}: every scheme that's on now
            or after it, and the backup of every safeguard that's raised or being set.
          </div>
        )
      )}
      <div className="spacer">
        {(!setup || adding || canDeploy || (changed && funded)) && (
          <>
            <p className="label">Password</p>
            <input className="field" type="password" value={password} disabled={busy !== ""} onChange={(e) => setPassword(e.target.value)} />
          </>
        )}
      </div>
      {error && <p className="error check-lines">{error}</p>}
      {done && <p className="hint">{done}</p>}
      {setup ? (
        <div className="row">
          <button className="btn btn-secondary" disabled={busy !== "" || !changed || next.length === 0 || (adding && !password)} onClick={save}>
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          <button
            className="btn btn-primary"
            disabled={busy !== "" || next.length === 0 || !password || !funded || (!changed && !canDeploy)}
            onClick={deploy}
          >
            {busy === "deploy" ? "Deploying…" : changed ? "Save and deploy" : "Deploy now"}
          </button>
        </div>
      ) : (
        <button
          className="btn btn-primary"
          disabled={busy !== "" || deployed === undefined || !password || !changed || next.length === 0}
          onClick={apply}
        >
          {busy === "apply" ? "Applying…" : "Sign and apply"}
        </button>
      )}
    </div>
  );
}
