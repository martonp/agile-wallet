import { SchemeChip } from "../components/SchemeChip";
import { Header } from "../components/Header";
import { MOCK_ACCOUNT } from "../mock";

export function Send({ onBack }: { onBack: () => void }) {
  const { balance, fee, schemes } = MOCK_ACCOUNT;
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
      <button className="btn btn-primary spacer">
        Sign and send
      </button>
    </div>
  );
}
