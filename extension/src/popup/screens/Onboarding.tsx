import { useState } from "react";
import { Header } from "../components/Header";
import { Dodger } from "../components/Dodger";
import { SCHEMES } from "../schemes";
import type { Account } from "../../wallet/account";
import { createWallet } from "../../wallet/keyring";
import { entropyToPhrase, generateEntropy, phraseToEntropy } from "../../wallet/mnemonic";

const MIN_PASSWORD = 8;

type Mode = "choose" | "create" | "import" | "backup";

export function Onboarding({ onDone }: { onDone: (account: Account) => void }) {
  const [mode, setMode] = useState<Mode>("choose");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [phrase, setPhrase] = useState("");
  const [entropy, setEntropy] = useState<Uint8Array>();
  const [wroteItDown, setWroteItDown] = useState(false);
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

  // The wallet starts with every scheme saved; the user picks its schemes when setting it up or on its first send,
  // since they take effect only with the first transaction.
  // On failure the entropy stays for a retry; zeroed, it would make a wallet of zero bytes.
  async function save(secret: Uint8Array) {
    setBusy(true);
    try {
      const account = await createWallet(password, secret, SCHEMES);
      secret.fill(0);
      onDone(account);
    } catch {
      setError("Couldn't create the wallet. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
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
    setError("");
    // A retry parses the phrase again, so the entropy needn't outlive this attempt.
    try {
      await save(imported);
    } finally {
      imported.fill(0);
    }
  }

  if (mode === "choose") {
    return (
      <div className="screen">
        <div className="brand">
          <h1 className="wordmark">Agile Wallet</h1>
          <p className="tagline">The crypto-agile wallet</p>
        </div>
        <Dodger />
        <p className="hint" style={{ textAlign: "center" }}>
          When a signature scheme breaks, your wallet doesn't.
        </p>
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
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary spacer" disabled={busy || !wroteItDown} onClick={() => save(entropy)}>
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
