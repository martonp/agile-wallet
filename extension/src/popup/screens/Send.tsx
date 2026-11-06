import { useEffect, useState } from "react";
import { type Address, isAddress, parseEther } from "viem";
import { SchemeChip } from "../components/SchemeChip";
import { Header } from "../components/Header";
import { SendProgress, type Tracker } from "../components/SendProgress";
import { shortAddress } from "../format";
import { type Account, type AccountState, accountState, formatEth, loadAccount, syncAccount } from "../../wallet/account";
import { loadNetwork } from "../../wallet/network";
import { type Progress, type Sent, sendTransfer, transferFee } from "../../wallet/transaction";
import { WrongPasswordError } from "../../wallet/vault";


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

  useEffect(() => {
    (async () => {
      const network = await loadNetwork();
      const loaded = await syncAccount(network, index).catch(() => loadAccount(index));
      setAccount(loaded);
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

  async function signAndSend() {
    const value = check();
    if (typeof value === "string") return setError(value);
    if (!account) return;
    setError("");
    setSent(undefined);
    setTracker(undefined);
    setBusy(true);
    try {
      const result = await sendTransfer(password, account, { to: to as Address, value }, onProgress);
      setSent(result);
      setTracker((t) => t && { ...t, phase: "done", block: result.block, ok: result.ok });
      setTo("");
      setAmount("");
      if (state) setState(await accountState(await loadNetwork(), account).catch(() => state));
      setFee(await transferFee(account).then((f) => f.maxFee, () => fee));
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
      <Header title="Send ETH" onBack={onBack} />
      <div>
        <p className="label">To</p>
        <input className="field mono" placeholder="0x…" value={to} spellCheck={false} onChange={(e) => setTo(e.target.value.trim())} />
      </div>
      <div>
        <p className="label">Amount</p>
        <input className="field" placeholder="0.0" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} />
        <p className="hint" style={{ marginTop: 4 }}>
          Available: {state ? formatEth(state.balance) : "—"} ETH
          {state && !state.deployed && " · this transaction also deploys the wallet"}
        </p>
      </div>
      {tracker ? (
        <SendProgress tracker={tracker} />
      ) : (
        <div className="panel">
          <p className="label">Signed with</p>
          <div className="chips">
            {account?.schemes.map((s) => (
              <SchemeChip key={s.scheme} scheme={s.scheme} />
            ))}
          </div>
          <div className="row" style={{ justifyContent: "space-between", marginTop: 10, fontSize: 13 }}>
            <span style={{ color: "var(--muted)" }}>Network fee</span>
            <span>{fee !== undefined ? `up to ${formatEth(fee, 5)} ETH` : "—"}</span>
          </div>
        </div>
      )}
      <div className="spacer">
        <p className="label">Password</p>
        <input className="field" type="password" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p className="error check-lines">{error}</p>}
      {sent && (
        <p className={sent.ok ? "hint" : "error"}>
          {sent.ok ? "Sent" : "Mined, but a frame failed"} in block {sent.block.toString()}: <span className="mono">{shortAddress(sent.hash)}</span>
        </p>
      )}
      <button className="btn btn-primary" disabled={busy || !password} onClick={signAndSend}>
        {busy ? "Sending…" : "Sign and send"}
      </button>
    </div>
  );
}
