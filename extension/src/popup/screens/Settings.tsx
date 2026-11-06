import { useEffect, useState } from "react";
import { Header } from "../components/Header";
import { explain } from "../../wallet/errors";
import {
  LABEL,
  type Network,
  checkNetwork,
  invalidField,
  loadNetwork,
  requestHostAccess,
  saveNetwork,
} from "../../wallet/network";

export function Settings({ onBack }: { onBack: () => void }) {
  const [network, setNetwork] = useState<Network>();
  const [saved, setSaved] = useState<Network>();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ error?: string; info?: string; lines?: string[] }>({});

  useEffect(() => {
    loadNetwork().then((loaded) => {
      setNetwork(loaded);
      setSaved(loaded);
    });
  }, []);
  if (!network) return null;

  // Leaving with edits that aren't saved asks first.
  const dirty = network.url !== saved?.url;
  const back = () => (dirty ? setConfirmLeave(true) : onBack());

  // Both actions ask for host access first, while the click still counts as a user gesture.
  async function withAccess(run: () => Promise<void>) {
    const problem = invalidField(network!);
    if (problem) return setResult({ error: problem });
    setBusy(true);
    try {
      if (!(await requestHostAccess(network!))) return setResult({ error: "Chrome didn't grant access to these hosts." });
      await run();
    } catch (e) {
      setResult({ error: explain(e) });
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    withAccess(async () => {
      await saveNetwork(network);
      setSaved(network);
      setResult({ info: "Saved." });
    });
  const test = () =>
    withAccess(async () => {
      const { ok, lines } = await checkNetwork(network);
      setResult(ok ? { info: "Connected.", lines } : { error: "Connection check failed.", lines });
    });

  return (
    <div className="screen">
      <Header title="Network" onBack={back} />
      <div>
        <p className="label">{LABEL}</p>
        <input
          className="field mono"
          value={network.url}
          spellCheck={false}
          onChange={(e) => setNetwork({ url: e.target.value.trim() })}
        />
        <p className="hint" style={{ marginTop: 4 }}>
          Transactions go to this node, and it forwards the wallet's reads to its EIP-8141 node.
        </p>
      </div>
      {result.error && <p className="error">{result.error}</p>}
      {result.info && <p className="hint">{result.info}</p>}
      {result.lines && (
        <ul className="hint mono check-lines">
          {result.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {confirmLeave && (
        <div className="warning">
          Discard your changes?
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-secondary" onClick={() => setConfirmLeave(false)}>
              Keep editing
            </button>
            <button className="btn btn-primary" onClick={onBack}>
              Discard
            </button>
          </div>
        </div>
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
