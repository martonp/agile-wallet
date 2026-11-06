import { useEffect, useState } from "react";
import { Header } from "../components/Header";
import { SchemeChip } from "../components/SchemeChip";
import { SCHEMES, type Scheme } from "../schemes";
import { accountCount } from "../../wallet/account";
import { addAccount } from "../../wallet/keyring";
import { loadNetwork } from "../../wallet/network";
import { explain } from "../../wallet/errors";

// The next account of the same recovery phrase: its own keys and wallet address.
export function AddAccount({ onBack, onDone }: { onBack: () => void; onDone: (index: number) => void }) {
  const [name, setName] = useState("");
  const [schemes, setSchemes] = useState<Scheme[]>(SCHEMES);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    accountCount().then((count) => setName(`Account ${count + 1}`));
  }, []);

  const toggle = (s: Scheme) => setSchemes((on) => (on.includes(s) ? on.filter((x) => x !== s) : [...on, s]));

  async function create() {
    setBusy(true);
    setError("");
    try {
      const account = await addAccount(password, name.trim() || "Account", schemes, await loadNetwork());
      onDone(account.index);
    } catch (e) {
      setError(explain(e));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <Header title="Add account" onBack={onBack} />
      <div>
        <p className="label">Name</p>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <p className="label">Signature schemes</p>
        {SCHEMES.map((s) => (
          <label key={s} className="toggle-row">
            <SchemeChip scheme={s} />
            <input type="checkbox" className="switch" checked={schemes.includes(s)} onChange={() => toggle(s)} />
          </label>
        ))}
        <p className="hint">If this account's wallet is already on chain, it keeps the schemes it has there.</p>
      </div>
      {schemes.length === 0 && <p className="error">Turn on at least one scheme.</p>}
      <div className="spacer">
        <p className="label">Password</p>
        <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary" disabled={busy || !password || schemes.length === 0} onClick={create}>
        {busy ? "Creating…" : "Add account"}
      </button>
    </div>
  );
}
