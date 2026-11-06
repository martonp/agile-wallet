import { useState } from "react";
import { IconShieldLock } from "@tabler/icons-react";
import { Header } from "../components/Header";
import { SchemeChip } from "../components/SchemeChip";
import { SCHEMES, type Scheme } from "../schemes";
import { createWallet } from "../../wallet/keyring";
import { entropyToPhrase, generateEntropy, phraseToEntropy } from "../../wallet/mnemonic";

const MIN_PASSWORD = 8;

type Mode = "choose" | "create" | "import" | "backup" | "schemes";

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>("choose");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [phrase, setPhrase] = useState("");
  const [entropy, setEntropy] = useState<Uint8Array>();
  const [wroteItDown, setWroteItDown] = useState(false);
  const [schemes, setSchemes] = useState<Scheme[]>(SCHEMES);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function go(next: Mode) {
    entropy?.fill(0);
    setEntropy(undefined);
    setError("");
    setMode(next);
  }

  function passwordError() {
    if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
    if (password !== confirm) return "Passwords don't match.";
    return "";
  }

  // On failure the entropy stays for a retry; zeroed, it would make a wallet of zero bytes.
  async function save(secret: Uint8Array) {
    setBusy(true);
    try {
      await createWallet(password, secret, schemes);
      secret.fill(0);
      onDone();
    } catch {
      setError("Couldn't create the wallet. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    const problem = passwordError();
    if (problem) return setError(problem);
    if (mode === "create") {
      setEntropy(generateEntropy());
      setError("");
      setMode("backup");
      return;
    }
    let imported: Uint8Array;
    try {
      imported = phraseToEntropy(phrase);
    } catch {
      return setError("That recovery phrase isn't valid. Check the words and their order.");
    }
    setPhrase("");
    setEntropy(imported);
    setError("");
    setMode("schemes");
  }

  if (mode === "choose") {
    return (
      <div className="screen">
        <Header title="Agile Wallet">
          <IconShieldLock size={20} color="var(--faint)" aria-hidden />
        </Header>
        <p className="hint">One recovery phrase protects your ECDSA, Falcon-512 and SPHINCS+ keys.</p>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => go("create")}>
          Create new wallet
        </button>
        <button className="btn btn-secondary" onClick={() => go("import")}>
          Import recovery phrase
        </button>
      </div>
    );
  }

  if (mode === "backup" && entropy) {
    return (
      <div className="screen">
        <Header title="Your recovery phrase" onBack={() => go("create")} />
        <p className="hint">Write these 24 words down in order and keep them offline. They're the only way to restore your wallet, and you won't see them again.</p>
        <ol className="words">
          {entropyToPhrase(entropy)
            .split(" ")
            .map((word, i) => (
              <li key={i}>{word}</li>
            ))}
        </ol>
        <label className="row hint" style={{ alignItems: "center" }}>
          <input type="checkbox" checked={wroteItDown} onChange={(e) => setWroteItDown(e.target.checked)} />
          I've written down my recovery phrase
        </label>
        <button className="btn btn-primary spacer" disabled={!wroteItDown} onClick={() => setMode("schemes")}>
          Continue
        </button>
      </div>
    );
  }

  if (mode === "schemes" && entropy) {
    const toggle = (s: Scheme) => setSchemes((on) => (on.includes(s) ? on.filter((x) => x !== s) : [...on, s]));
    return (
      <div className="screen">
        <Header title="Signature schemes" onBack={() => go("choose")} />
        <p className="hint">Every transaction needs a signature from each scheme you turn on. You can change them later.</p>
        <div>
          {SCHEMES.map((s) => (
            <label key={s} className="toggle-row">
              <SchemeChip scheme={s} />
              <input type="checkbox" className="switch" checked={schemes.includes(s)} onChange={() => toggle(s)} />
            </label>
          ))}
        </div>
        {schemes.length === 0 && <p className="error">Turn on at least one scheme.</p>}
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary spacer" disabled={busy || schemes.length === 0} onClick={() => save(entropy)}>
          {busy ? "Creating…" : "Create wallet"}
        </button>
      </div>
    );
  }

  return (
    <div className="screen">
      <Header title={mode === "create" ? "Create wallet" : "Import wallet"} onBack={() => go("choose")} />
      {mode === "import" && (
        <div>
          <p className="label">Recovery phrase</p>
          <textarea className="field" rows={3} placeholder="twelve or twenty-four words" value={phrase} onChange={(e) => setPhrase(e.target.value)} />
        </div>
      )}
      <div>
        <p className="label">Password</p>
        <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div>
        <p className="label">Confirm password</p>
        <input className="field" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary spacer" disabled={busy} onClick={submit}>
        {busy ? "Encrypting…" : "Continue"}
      </button>
    </div>
  );
}
