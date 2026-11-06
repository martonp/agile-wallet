import { useEffect, useState } from "react";
import { IconCheck, IconCopy, IconLock, IconSettings } from "@tabler/icons-react";
import { SchemeChip } from "../components/SchemeChip";
import { Header } from "../components/Header";
import { shortAddress } from "../format";
import { SCHEMES } from "../schemes";
import { type Account as AccountData, type AccountState, accountState, formatEth, loadAccount } from "../../wallet/account";
import { loadNetwork } from "../../wallet/network";

type Props = { onSend: () => void; onSchemes: () => void; onSettings: () => void; onLock: () => void };

export function Account({ onSend, onSchemes, onSettings, onLock }: Props) {
  const [account, setAccount] = useState<AccountData>();
  const [state, setState] = useState<AccountState>();
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // Re-reads the address, balance and deployment every 2 seconds while the screen is open; each read waits for the
  // previous one, so a slow node never stacks requests.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const loaded = await loadAccount();
      if (stopped) return;
      setAccount(loaded);
      if (!loaded) return;
      const network = await loadNetwork();
      const refresh = async () => {
        try {
          const next = await accountState(network, loaded);
          if (stopped) return;
          setState(next);
          setError("");
        } catch {
          if (stopped) return;
          setError("Can't reach the network. Check its settings.");
        }
        timer = setTimeout(refresh, 2000);
      };
      await refresh();
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  async function copy() {
    if (!state) return;
    await navigator.clipboard.writeText(state.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const schemes = account?.schemes.map((s) => s.scheme) ?? [];
  return (
    <div className="screen">
      <Header title="Account 1">
        <span className="row">
          <button className="icon-button" onClick={onSettings} aria-label="Network settings">
            <IconSettings size={18} />
          </button>
          <button className="icon-button" onClick={onLock} aria-label="Lock">
            <IconLock size={18} />
          </button>
        </span>
      </Header>
      <div className="mono row" style={{ alignItems: "center", color: "var(--muted)" }}>
        {state ? shortAddress(state.address) : "…"}
        <button className="icon-button" onClick={copy} disabled={!state} aria-label="Copy address">
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        </button>
      </div>
      <div className="panel">
        <p className="label">Balance</p>
        <div className="balance">{state ? `${formatEth(state.balance)} ETH` : "—"}</div>
        {state && !state.deployed && <p className="hint">Not deployed yet: your first transaction deploys it.</p>}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn btn-primary" onClick={onSend}>
          Send
        </button>
        <button className="btn btn-secondary" onClick={copy} disabled={!state}>
          {copied ? "Address copied" : "Receive"}
        </button>
      </div>
      <div>
        <p className="label">Signature schemes</p>
        <div className="chips">
          {SCHEMES.map((s) => (
            <SchemeChip key={s} scheme={s} off={!schemes.includes(s)} />
          ))}
        </div>
      </div>
      <p className="hint">
        {schemes.length} of {SCHEMES.length} schemes protect this account
      </p>
      <button className="btn btn-secondary spacer" onClick={onSchemes}>
        Change schemes
      </button>
    </div>
  );
}
