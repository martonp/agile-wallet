import { useEffect, useState } from "react";
import { type Address, isAddress, parseEther } from "viem";
import { SchemeChip } from "../components/SchemeChip";
import { Header } from "../components/Header";
import { shortAddress } from "../mock";
import { type Account, type AccountState, accountState, formatEth, loadAccount } from "../../wallet/account";
import { loadNetwork } from "../../wallet/network";
import { type Sent, type Step, sendTransfer } from "../../wallet/transaction";
import { WrongPasswordError } from "../../wallet/vault";

const STEP_TEXT: Record<Step, string> = {
  signing: "Signing…",
  sending: "Sending to the VPR mempool…",
  mining: "Waiting for a block…",
};

export function Send({ onBack }: { onBack: () => void }) {
  const [account, setAccount] = useState<Account>();
  const [state, setState] = useState<AccountState>();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<Step>();
  const [sent, setSent] = useState<Sent>();
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const loaded = await loadAccount();
      setAccount(loaded);
      if (loaded) setState(await accountState(await loadNetwork(), loaded).catch(() => undefined));
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
    if (state && value > state.balance) return "That's more than the wallet holds.";
    return value;
  }

  async function signAndSend() {
    const value = check();
    if (typeof value === "string") return setError(value);
    if (!account) return;
    setError("");
    setSent(undefined);
    try {
      setSent(await sendTransfer(password, account, { to: to as Address, value }, setStep));
      setTo("");
      setAmount("");
      if (state) setState(await accountState(await loadNetwork(), account).catch(() => state));
    } catch (e) {
      setError(e instanceof WrongPasswordError ? "Wrong password. Try again." : e instanceof Error ? e.message : String(e));
    } finally {
      setPassword("");
      setStep(undefined);
    }
  }

  const busy = step !== undefined;
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
      <div className="panel">
        <p className="label">Signed with</p>
        <div className="chips">
          {account?.schemes.map((s) => (
            <SchemeChip key={s.scheme} scheme={s.scheme} />
          ))}
        </div>
      </div>
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
        {step ? STEP_TEXT[step] : "Sign and send"}
      </button>
    </div>
  );
}
