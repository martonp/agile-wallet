import { useEffect, useState } from "react";
import { type Address, formatEther, isAddress, parseEther } from "viem";
import { SchemeChip } from "../components/SchemeChip";
import { Header } from "../components/Header";
import { type Safeguards, SchemeChoices, choicesChanged, ruleChoices, safeguardsOf } from "../components/SchemeChoices";
import type { Tracker } from "../components/SendProgress";
import { Submission } from "../components/Submission";
import { shortAddress } from "../format";
import { type Account, type AccountState, accountState, formatEth, loadAccount, syncAccount } from "../../wallet/account";
import { loadNetwork } from "../../wallet/network";
import type { Scheme } from "../schemes";
import { type Progress, type Sent, changeSchemesBeforeDeployment, sendTransfer, transferFee } from "../../wallet/transaction";
import { explain } from "../../wallet/errors";

export function Send({ index, onBack }: { index: number; onBack: () => void }) {
  const [account, setAccount] = useState<Account>();
  const [state, setState] = useState<AccountState>();
  const [fee, setFee] = useState<bigint>();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [tracker, setTracker] = useState<Tracker>();
  const [sent, setSent] = useState<Sent>();
  const [error, setError] = useState("");
  // A first send also deploys the wallet: after the amount, a second step shows what it deploys with. Signing and
  // sending then happen on a submission screen of their own.
  const [step, setStep] = useState<"amount" | "deployment" | "submission">("amount");
  const [deploys, setDeploys] = useState(false); // the submission also deploys the wallet
  const [sending, setSending] = useState(0n); // what the submission sends, in wei
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [safeguards, setSafeguards] = useState<Safeguards>(safeguardsOf(undefined));

  function show(loaded: Account | undefined) {
    setAccount(loaded);
    setSchemes(loaded?.schemes.map((s) => s.scheme) ?? []);
    setSafeguards(safeguardsOf(loaded));
  }

  useEffect(() => {
    (async () => {
      const network = await loadNetwork();
      const loaded = await syncAccount(network, index).catch(() => loadAccount(index));
      show(loaded);
      if (!loaded) return;
      setState(await accountState(network, loaded).catch(() => undefined));
      setFee(await transferFee(loaded).then((f) => f.maxFee, () => undefined));
    })();
  }, []);

  // The amount in wei, or a message saying what's wrong with the form.
  function check(): bigint | string {
    if (!isAddress(to)) return "Enter a 0x… address to send to.";
    let value: bigint;
    try {
      value = parseEther(amount);
    } catch {
      return "Enter an amount in ETH.";
    }
    if (value <= 0n) return "Enter an amount above zero.";
    if (state && value + (fee ?? 0n) > state.balance) {
      return fee ? `That plus the network fee (up to ${formatEth(fee, 5)} ETH) is more than the wallet holds.` : "That's more than the wallet holds.";
    }
    return value;
  }

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

  const undeployed = state?.deployed === false;
  // Only a first send changes the wallet's setup; a deployed wallet's goes through Change Schemes.
  const changed = undeployed && choicesChanged(account, schemes, safeguards);

  function next() {
    const value = check();
    if (typeof value === "string") return setError(value);
    setError("");
    setSent(undefined);
    setTracker(undefined);
    setStep("deployment");
  }

  async function signAndSend() {
    const value = check();
    if (typeof value === "string") return setError(value);
    if (!account) return;
    setError("");
    setSent(undefined);
    setTracker(undefined);
    setSending(value);
    setDeploys(undeployed);
    setStep("submission");
    setBusy(true);
    try {
      // The deployment's choices are saved first, so the first transaction carries them.
      const from = changed
        ? await changeSchemesBeforeDeployment(password, account, { schemes, rules: ruleChoices(safeguards, schemes) })
        : account;
      show(from);
      const result = await sendTransfer(password, from, { to: to as Address, value }, onProgress);
      setSent(result);
      setTracker((t) => t && { ...t, phase: "done", block: result.block, ok: result.ok });
    } catch (e) {
      setTracker((t) => t && { ...t, failed: true });
      setError(explain(e));
      // The deployment's choices may have been saved before the failure, and the wallet may have been deployed from
      // elsewhere meanwhile: the fee and the state follow.
      const latest = await loadAccount(index);
      if (latest) {
        setFee(await transferFee(latest).then((f) => f.maxFee, () => fee));
        setState(await accountState(await loadNetwork(), latest).catch(() => state));
      }
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  if (step === "submission") {
    return (
      <Submission
        title="Send ETH"
        busyTitle="Sending"
        summary={
          <>
            <div className="balance">{formatEther(sending)} ETH</div>
            <p className="hint">
              to <span className="mono">{shortAddress(to)}</span>
              {deploys && ", and deploys your wallet"}
            </p>
          </>
        }
        tracker={tracker}
        busy={busy}
        sent={sent}
        label="Sent"
        error={error}
        onEdit={() => {
          setError("");
          setTracker(undefined);
          setSent(undefined);
          setStep(deploys ? "deployment" : "amount");
        }}
        onDone={onBack}
      />
    );
  }

  if (step === "deployment") {
    return (
      <div className="screen">
        <Header title="Send ETH" onBack={() => setStep("amount")} />
        <p className="hint">
          Sending {amount} ETH to <span className="mono">{shortAddress(to)}</span>. This first transaction also deploys
          your wallet: choose the signatures every transaction will need, and the safeguards.
        </p>
        <SchemeChoices
          account={account}
          schemes={schemes}
          onSchemes={setSchemes}
          safeguards={safeguards}
          onSafeguards={setSafeguards}
          signals={state?.signals ?? {}}
          deployed={state?.deployed}
        />
        {schemes.length === 0 ? (
          <p className="error">Keep at least one scheme.</p>
        ) : (
          <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: "var(--muted)" }}>Network fee</span>
            <span>{changed ? "worked out when you send" : fee !== undefined ? `up to ${formatEth(fee, 5)} ETH` : "—"}</span>
          </div>
        )}
        <div className="spacer">
          <p className="label">Password</p>
          <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="error check-lines">{error}</p>}
        <div className="row">
          <button className="btn btn-secondary" onClick={() => setStep("amount")}>
            Back
          </button>
          <button className="btn btn-primary" disabled={!password || schemes.length === 0} onClick={signAndSend}>
            Sign and send
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <Header title="Send ETH" onBack={onBack} />
      <div>
        <p className="label">To</p>
        <input className="field mono" placeholder="0x…" value={to} spellCheck={false} onChange={(e) => setTo(e.target.value.trim())} />
      </div>
      <div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <p className="label">Amount</p>
          {/* Everything the wallet holds, less the most the network fee can be. */}
          <button className="link" disabled={!state || fee === undefined || state.balance <= fee} onClick={() => setAmount(formatEther(state!.balance - fee!))}>
            Max
          </button>
        </div>
        <input className="field" placeholder="0.0" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} />
        <p className="hint" style={{ marginTop: 4 }}>
          Available: {state ? formatEth(state.balance) : "—"} ETH
        </p>
      </div>
      <div className="panel">
        {undeployed ? (
          <p className="hint">This first transaction also deploys your wallet. Next, choose what it's deployed with.</p>
        ) : (
          <>
            <p className="label">Signed with</p>
            <div className="chips">
              {account?.schemes.map((s) => (
                <SchemeChip key={s.scheme} scheme={s.scheme} />
              ))}
            </div>
          </>
        )}
        <div className="row" style={{ justifyContent: "space-between", marginTop: 10, fontSize: 13 }}>
          <span style={{ color: "var(--muted)" }}>Network fee</span>
          <span>{fee !== undefined ? `up to ${formatEth(fee, 5)} ETH` : "—"}</span>
        </div>
      </div>
      <div className="spacer">
        {state && !undeployed && (
          <>
            <p className="label">Password</p>
            <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </>
        )}
      </div>
      {error && <p className="error check-lines">{error}</p>}
      {undeployed ? (
        <button className="btn btn-primary" disabled={!state} onClick={next}>
          Next
        </button>
      ) : (
        <button className="btn btn-primary" disabled={!password || !state} onClick={signAndSend}>
          Sign and send
        </button>
      )}
    </div>
  );
}
