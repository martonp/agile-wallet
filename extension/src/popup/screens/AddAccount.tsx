import { useEffect, useState } from "react";
import { Header } from "../components/Header";
import { SCHEMES } from "../schemes";
import { type Account, accountCount } from "../../wallet/account";
import { addAccount } from "../../wallet/keyring";
import { loadNetwork } from "../../wallet/network";
import { explain } from "../../wallet/errors";

// The next account of the same recovery phrase: its own keys and wallet address. Like a new wallet, it starts with
// every scheme saved, and the user picks its schemes when setting it up or on its first send.
export function AddAccount({ onBack, onDone }: { onBack: () => void; onDone: (account: Account) => void }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    accountCount().then((count) => setName(`Account ${count + 1}`));
  }, []);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const account = await addAccount(password, name.trim() || "Account", SCHEMES, await loadNetwork());
      onDone(account);
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
        <p className="label">Password</p>
        <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary spacer" disabled={busy || !password} onClick={create}>
        {busy ? "Creating…" : "Add account"}
      </button>
    </div>
  );
}
