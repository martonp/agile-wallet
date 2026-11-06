import { IconCopy, IconLock, IconSettings } from "@tabler/icons-react";
import { SchemeChip } from "../components/SchemeChip";
import { Header } from "../components/Header";
import { MOCK_ACCOUNT, shortAddress } from "../mock";
import { SCHEMES } from "../schemes";

type Props = { onSend: () => void; onSchemes: () => void; onSettings: () => void; onLock: () => void };

export function Account({ onSend, onSchemes, onSettings, onLock }: Props) {
  const { name, address, balance, schemes } = MOCK_ACCOUNT;
  return (
    <div className="screen">
      <Header title={name}>
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
        {shortAddress(address)}
        <button className="icon-button" aria-label="Copy address">
          <IconCopy size={14} />
        </button>
      </div>
      <div className="panel">
        <p className="label">Balance</p>
        <div className="balance">{balance} ETH</div>
      </div>
      <div className="row">
        <button className="btn btn-primary" onClick={onSend}>
          Send
        </button>
        <button className="btn btn-secondary">Receive</button>
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
