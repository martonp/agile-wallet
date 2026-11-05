import { IconLock } from "@tabler/icons-react";

export function Unlock({ onUnlock, onForgot }: { onUnlock: () => void; onForgot: () => void }) {
  return (
    <div className="screen" style={{ justifyContent: "center", textAlign: "center" }}>
      <IconLock size={28} color="var(--faint)" style={{ alignSelf: "center" }} aria-hidden />
      <div className="header" style={{ justifyContent: "center", fontSize: 16 }}>
        Welcome back
      </div>
      <p className="hint">Enter your password to unlock your wallet.</p>
      <input className="field" type="password" autoFocus />
      <button className="btn btn-primary" onClick={onUnlock}>
        Unlock
      </button>
      <button className="link" onClick={onForgot}>
        Forgot it? Restore from your recovery phrase
      </button>
    </div>
  );
}
