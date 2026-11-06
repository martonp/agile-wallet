import { useEffect, useState } from "react";
import { IconCheck, IconCopy, IconLock, IconSettings } from "@tabler/icons-react";
import { SchemeChip } from "../components/SchemeChip";
import { AccountMenu } from "../components/AccountMenu";
import { Activity } from "../components/Activity";
import { Header } from "../components/Header";
import { shortAddress } from "../format";
import { SCHEMES, SCHEME_INFO } from "../schemes";
import { type Account as AccountData, type AccountState, accountState, formatEth, loadAccount, raisedRules, syncAccount } from "../../wallet/account";
import { type HistoryEntry, syncHistory } from "../../wallet/history";
import { SIGNALS, loadNetwork } from "../../wallet/network";

type Props = {
  index: number;
  notice?: string;
  onSelect: (index: number) => void;
  onAddAccount: () => void;
  onSend: () => void;
  onReceive: () => void;
  onOpenTransaction: (hash: string) => void;
  onSchemes: () => void;
  onSettings: () => void;
  onLock: () => void;
};

export function Account({ index, notice, onSelect, onAddAccount, onSend, onReceive, onOpenTransaction, onSchemes, onSettings, onLock }: Props) {
  const [account, setAccount] = useState<AccountData>();
  const [state, setState] = useState<AccountState>();
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [uncopied, setUncopied] = useState(""); // the address, when the browser refused the clipboard
  const [history, setHistory] = useState<HistoryEntry[]>([]);

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
          current = (await loadAccount(index)) ?? current; // picks up a rename, here or in another popup
          let next = await accountState(network, current!);
          // A scheme change can land while the screen is open, after the popup that sent it closed.
          if (!next.schemesMatch) {
            const synced = await syncAccount(network, index);
            if (synced && synced !== current) {
              current = synced;
              next = await accountState(network, current);
            }
          }
          // Sends whose popup closed before they were mined are settled here too.
          const activity = await syncHistory(network, index);
          if (stopped) return;
          setAccount(current);
          setState(next);
          setHistory(activity);
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

  // A raised safeguard's backup signs every transaction, as a scheme does.
  const raised = account && state ? raisedRules(account, state.signals) : [];
  const schemes = [...new Set([...(account?.schemes.map((s) => s.scheme) ?? []), ...raised.map((r) => r.scheme)])];
  const undeployed = state?.deployed === false;
  // The first transaction was sent and isn't mined yet.
  const deploying = undeployed && history.some((e) => e.deploys && e.status === "pending");
  const raisedSignals = SIGNALS.filter((s) => (state?.signals[s.address.toLowerCase()] ?? 0) > 0);
  return (
    <div className="screen">
      <Header title={account ? <AccountMenu current={account} onSelect={onSelect} onAdd={onAddAccount} onRenamed={() => loadAccount(index).then(setAccount)} /> : ""}>
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
      </div>
      {notice && <div className="warning">{notice}</div>}
      {error && <p className="error">{error}</p>}
      {uncopied && (
        <p className="hint check-lines">
          Couldn't copy. Your address: <span className="mono">{uncopied}</span>
        </p>
      )}
      {state && !state.schemesMatch && (
        <div className="warning">
          The schemes and safeguards saved here aren't this wallet's on chain, so its transactions will fail.
        </div>
      )}
      {state &&
        raisedSignals.map((s) => {
          const broken = SCHEME_INFO[s.breaks].label;
          const rule = raised.find((r) => r.signal.toLowerCase() === s.address.toLowerCase());
          if (rule) {
            return (
              <div key={s.address} className="warning">
                {broken} was signalled broken: {SCHEME_INFO[rule.scheme].label} now also signs every transaction.
              </div>
            );
          }
          // The owner key fixes an undeployed wallet's address, and it is ECDSA: whoever breaks ECDSA can deploy it first.
          if (!state.deployed && s.breaks === "ecdsa") {
            return (
              <div key={s.address} className="warning">
                {broken} was signalled broken and this wallet isn't deployed, so a safeguard can't protect it. Move its
                funds.
              </div>
            );
          }
          if (schemes.every((scheme) => scheme === s.breaks)) {
            return (
              <div key={s.address} className="warning">
                {broken} was signalled broken and it is this wallet's only scheme. Add another one.
              </div>
            );
          }
          return null;
        })}
      <div className="row">
        <button className="btn btn-primary" onClick={onSend}>
          Send
        </button>
        <button className="btn btn-secondary" onClick={onReceive}>
          Receive
        </button>
      </div>
      {undeployed ? (
        // Nothing enforces the schemes before deployment: the owner key guards the address.
        <div className="panel undeployed">
          <p className="undeployed-title">Your wallet isn't deployed yet</p>
          <p className="hint">
            This address can already receive ETH. Until the wallet is deployed, only your owner key can deploy it, and
            that key's public key stays hidden until it signs.
          </p>
          <p className="hint">
            Deploying sets the signature schemes and safeguards that every later transaction needs. It happens with your
            first send, or you can deploy now.
          </p>
          {deploying ? (
            <p className="hint">Deploying: waiting for a block…</p>
          ) : (
            <button className="btn btn-primary" onClick={onSchemes}>
              Set up and deploy
            </button>
          )}
        </div>
      ) : (
        state && (
          <>
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
          </>
        )
      )}
      <Activity history={history} onOpen={onOpenTransaction} />
      {state?.deployed && (
        <button className="btn btn-secondary spacer" onClick={onSchemes}>
          Change schemes
        </button>
      )}
    </div>
  );
}
