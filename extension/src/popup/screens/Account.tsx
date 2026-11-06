import { useEffect, useState } from "react";
import { IconCheck, IconCopy, IconLock, IconSettings } from "@tabler/icons-react";
import { SchemeChip } from "../components/SchemeChip";
import { AccountMenu } from "../components/AccountMenu";
import { Header } from "../components/Header";
import { shortAddress } from "../format";
import { SCHEMES } from "../schemes";
import { type Account as AccountData, type AccountState, accountState, formatEth, loadAccount, syncAccount } from "../../wallet/account";
import { loadNetwork } from "../../wallet/network";

type Props = {
  index: number;
  onSelect: (index: number) => void;
  onAddAccount: () => void;
  onSend: () => void;
  onSchemes: () => void;
  onSettings: () => void;
  onLock: () => void;
};

export function Account({ index, onSelect, onAddAccount, onSend, onSchemes, onSettings, onLock }: Props) {
  const [account, setAccount] = useState<AccountData>();
  const [state, setState] = useState<AccountState>();
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [uncopied, setUncopied] = useState(""); // the address, when the browser refused the clipboard

  // Re-reads the address, balance and deployment every 2 seconds while the screen is open; each read waits for the
  // previous one, so a slow node never stacks requests.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const network = await loadNetwork();
      let current = await syncAccount(network, index).catch(() => loadAccount(index));
      if (stopped) return;
      setAccount(current);
      if (!current) return;
      const refresh = async () => {
        try {
          let next = await accountState(network, current!);
          // A scheme change can land while the screen is open, after the popup that sent it closed.
          if (!next.schemesMatch) {
            const synced = await syncAccount(network, index);
            if (synced && synced !== current) {
              current = synced;
              next = await accountState(network, current);
            }
          }
          if (stopped) return;
          setAccount(current);
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
  }, [index]);

  // Falls back to showing the whole address when the browser refuses the clipboard.
  async function copy() {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setUncopied(state.address);
    }
  }

  const schemes = account?.schemes.map((s) => s.scheme) ?? [];
  return (
    <div className="screen">
      <Header title={account ? <AccountMenu current={account} onSelect={onSelect} onAdd={onAddAccount} /> : ""}>
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
      {uncopied && (
        <p className="hint check-lines">
          Couldn't copy. Your address: <span className="mono">{uncopied}</span>
        </p>
      )}
      {state && !state.schemesMatch && (
        <div className="warning">The schemes saved here aren't this wallet's schemes on chain, so its transactions will fail.</div>
      )}
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
