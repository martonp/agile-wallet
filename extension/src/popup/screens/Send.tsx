import { useEffect, useState } from "react";
import { SchemeChip } from "../components/SchemeChip";
import { Header } from "../components/Header";
import { MOCK_ACCOUNT } from "../mock";
import type { Scheme } from "../schemes";
import { loadAccount } from "../../wallet/account";
import { ecdsaSign } from "../../wallet/ecdsa";
import { falconSign } from "../../wallet/falcon";
import { sphincsSign } from "../../wallet/sphincs";
import { withSigningKeys } from "../../wallet/keyring";
import { WrongPasswordError } from "../../wallet/vault";

export function Send({ onBack }: { onBack: () => void }) {
  const { balance, fee } = MOCK_ACCOUNT;
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ error?: string; info?: string }>({});

  useEffect(() => {
    loadAccount().then((account) => setSchemes(account?.schemes.map((s) => s.scheme) ?? []));
  }, []);

  async function signAndSend() {
    setBusy(true);
    try {
      const started = performance.now();
      await withSigningKeys(password, schemes, async (keys) => {
        // TODO: sign the frame transaction's sig hash once the builder exists. Until then, sign a
        // dummy digest so the signers run inside the real extension.
        if (keys.ecdsa) ecdsaSign(keys.ecdsa, new Uint8Array(32));
        if (keys.falcon) await falconSign(keys.falcon, new Uint8Array(32));
        if (keys.sphincs) await sphincsSign(keys.sphincs, new Uint8Array(32));
      });
      const ms = Math.round(performance.now() - started);
      setResult({ info: `Password OK, test-signed in ${ms} ms. Sending isn't built yet.` });
    } catch (e) {
      setResult({ error: e instanceof WrongPasswordError ? "Wrong password. Try again." : "Couldn't sign. Try again." });
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
        <input className="field mono" placeholder="0x…" />
      </div>
      <div>
        <p className="label">Amount</p>
        <input className="field" placeholder="0.0" inputMode="decimal" />
        <p className="hint" style={{ marginTop: 4 }}>
          Available: {balance} ETH
        </p>
      </div>
      <div className="panel">
        <p className="label">Signed with</p>
        <div className="chips">
          {schemes.map((s) => (
            <SchemeChip key={s} scheme={s} />
          ))}
        </div>
        <div className="row" style={{ justifyContent: "space-between", marginTop: 10, fontSize: 13 }}>
          <span style={{ color: "var(--muted)" }}>Network fee</span>
          <span>~{fee} ETH</span>
        </div>
      </div>
      <div className="spacer">
        <p className="label">Password</p>
        <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {result.error && <p className="error">{result.error}</p>}
      {result.info && <p className="hint">{result.info}</p>}
      <button className="btn btn-primary" disabled={busy || !password} onClick={signAndSend}>
        {busy ? "Signing…" : "Sign and send"}
      </button>
    </div>
  );
}
