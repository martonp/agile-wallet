import { useEffect, useState } from "react";
import { Header } from "../components/Header";
import {
  LABELS,
  LOCAL_DEVNET,
  type Network,
  checkNetwork,
  invalidField,
  loadNetwork,
  requestHostAccess,
  saveNetwork,
} from "../../wallet/network";

const FIELDS: (keyof Network)[] = ["rpcUrl", "sidecarUrl"];

export function Settings({ onBack }: { onBack: () => void }) {
  const [network, setNetwork] = useState<Network>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ error?: string; info?: string; lines?: string[] }>({});

  useEffect(() => {
    loadNetwork().then(setNetwork);
  }, []);
  if (!network) return null;

  // Both actions ask for host access first, while the click still counts as a user gesture.
  async function withAccess(run: () => Promise<void>) {
    const problem = invalidField(network!);
    if (problem) return setResult({ error: problem });
    setBusy(true);
    try {
      if (!(await requestHostAccess(network!))) return setResult({ error: "Chrome didn't grant access to these hosts." });
      await run();
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    withAccess(async () => {
      await saveNetwork(network);
      setResult({ info: "Saved." });
    });
  const test = () =>
    withAccess(async () => {
      const { ok, lines } = await checkNetwork(network);
      setResult(ok ? { info: "Connected.", lines } : { error: "Couldn't reach everything.", lines });
    });

  return (
    <div className="screen">
      <Header title="Network" onBack={onBack} />
      {FIELDS.map((field) => (
        <div key={field}>
          <p className="label">{LABELS[field]}</p>
          <input
            className="field mono"
            value={network[field]}
            spellCheck={false}
            onChange={(e) => setNetwork({ ...network, [field]: e.target.value.trim() })}
          />
        </div>
      ))}
      <button className="link" style={{ alignSelf: "flex-start" }} onClick={() => setNetwork(LOCAL_DEVNET)}>
        Reset to the local devnet
      </button>
      {result.error && <p className="error">{result.error}</p>}
      {result.info && <p className="hint">{result.info}</p>}
      {result.lines && (
        <ul className="hint mono check-lines">
          {result.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <div className="row spacer">
        <button className="btn btn-secondary" disabled={busy} onClick={test}>
          Test connection
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
