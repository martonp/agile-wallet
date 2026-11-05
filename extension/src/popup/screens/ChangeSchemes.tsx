import { useState } from "react";
import { SchemeChip } from "../components/SchemeChip";
import { Header } from "../components/Header";
import { MOCK_ACCOUNT } from "../mock";
import { SCHEMES, SCHEME_INFO, type Scheme } from "../schemes";

export function ChangeSchemes({ onBack }: { onBack: () => void }) {
  const current = MOCK_ACCOUNT.schemes;
  const [next, setNext] = useState<Scheme[]>(current);

  const toggle = (s: Scheme) => setNext((n) => (n.includes(s) ? n.filter((x) => x !== s) : [...n, s]));
  // setSchemes needs signatures from every scheme on before or after the change.
  const signers = SCHEMES.filter((s) => current.includes(s) || next.includes(s));

  return (
    <div className="screen">
      <Header title="Change schemes" onBack={onBack} />
      <p className="hint">Choose which signatures every transaction needs.</p>
      <div>
        {SCHEMES.map((s) => (
          <label key={s} className="toggle-row">
            <SchemeChip scheme={s} />
            <input type="checkbox" className="switch" checked={next.includes(s)} onChange={() => toggle(s)} />
          </label>
        ))}
      </div>
      <div className="warning">
        This change is signed by every scheme that's on now or after it:{" "}
        {signers.map((s) => SCHEME_INFO[s].label).join(", ")}.
      </div>
      <button className="btn btn-primary spacer">
        Sign and apply
      </button>
    </div>
  );
}
