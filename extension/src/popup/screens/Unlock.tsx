import { Dodger } from "../components/Dodger";

export function Unlock({ onUnlock, onForgot }: { onUnlock: () => void; onForgot: () => void }) {
  return (
    <div className="screen" style={{ textAlign: "center" }}>
      <div className="brand">
        <h1 className="wordmark">Agile Wallet</h1>
        <p className="tagline">Welcome back</p>
      </div>
      <Dodger />
      <p className="hint spacer">Enter your password to unlock your wallet.</p>
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
