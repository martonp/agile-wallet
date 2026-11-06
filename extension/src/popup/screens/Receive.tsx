import { useEffect, useState } from "react";
import qrcode from "qrcode-generator";
import { Header } from "../components/Header";
import { loadAccount, walletAddress } from "../../wallet/account";

// The wallet's address as an EIP-681 QR code, and in full to copy. Dark on white whatever the theme, so it scans.
export function Receive({ index, onBack }: { index: number; onBack: () => void }) {
  const [address, setAddress] = useState<string>();
  const [copied, setCopied] = useState<boolean>();

  useEffect(() => {
    loadAccount(index).then((account) => account && setAddress(walletAddress(account.owner)));
  }, [index]);
  if (!address) return null;

  const qr = qrcode(0, "M");
  qr.addData(`ethereum:${address}`);
  qr.make();
  const size = qr.getModuleCount();
  const cells: string[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) if (qr.isDark(row, col)) cells.push(`M${col} ${row}h1v1h-1z`);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(address!);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="screen">
      <Header title="Receive" onBack={onBack} />
      <svg className="qr" viewBox={`-2 -2 ${size + 4} ${size + 4}`} role="img" aria-label={`QR code of ${address}`}>
        <rect x={-2} y={-2} width={size + 4} height={size + 4} fill="#fff" />
        <path d={cells.join("")} fill="#000" />
      </svg>
      <p className="mono check-lines" style={{ textAlign: "center", margin: 0 }}>
        {address}
      </p>
      <p className="hint" style={{ textAlign: "center" }}>
        Send ETH on this network only. Funds can arrive before the wallet is deployed.
      </p>
      {copied === false && <p className="hint">Couldn't copy: select the address above instead.</p>}
      <button className="btn btn-primary spacer" onClick={copy}>
        {copied ? "Address copied" : "Copy address"}
      </button>
    </div>
  );
}
