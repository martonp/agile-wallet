import { useState } from "react";
import { IconShieldLock } from "@tabler/icons-react";
import { Header } from "../components/Header";

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"choose" | "create" | "import">("choose");

  if (mode === "choose") {
    return (
      <div className="screen">
        <Header title="Agile Wallet">
          <IconShieldLock size={20} color="var(--faint)" aria-hidden />
        </Header>
        <p className="hint">One recovery phrase protects your ECDSA, Falcon-512 and SPHINCS+ keys.</p>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setMode("create")}>
          Create new wallet
        </button>
        <button className="btn btn-secondary" onClick={() => setMode("import")}>
          Import recovery phrase
        </button>
      </div>
    );
  }

  return (
    <div className="screen">
      <Header title={mode === "create" ? "Create wallet" : "Import wallet"} onBack={() => setMode("choose")} />
      {mode === "import" && (
        <div>
          <p className="label">Recovery phrase</p>
          <textarea className="field" rows={3} placeholder="twelve or twenty-four words" />
        </div>
      )}
      <div>
        <p className="label">Password</p>
        <input className="field" type="password" />
      </div>
      <div>
        <p className="label">Confirm password</p>
        <input className="field" type="password" />
      </div>
      <button className="btn btn-primary spacer" onClick={onDone}>
        Continue
      </button>
    </div>
  );
}
