import { useEffect, useState } from "react";
import { IconExternalLink } from "@tabler/icons-react";
import { shortAddress } from "../format";
import { type Network, explorerLink, loadNetwork } from "../../wallet/network";

// A transaction hash, opening its page in the mempool explorer (in a new tab) when the network has one.
export function TxHash({ hash, full = false }: { hash: string; full?: boolean }) {
  const [network, setNetwork] = useState<Network>();
  useEffect(() => {
    void loadNetwork().then(setNetwork);
  }, []);
  const text = full ? hash : shortAddress(hash);
  const href = network && explorerLink(network, hash);
  if (!href) return <span className="mono">{text}</span>;
  return (
    <a className="mono tx-link" href={href} target="_blank" rel="noreferrer" title="Open in the explorer">
      {text}
      <IconExternalLink size={12} aria-hidden />
    </a>
  );
}
