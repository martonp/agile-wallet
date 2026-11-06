import { IconArrowUpRight, IconRocket, IconShieldCheck } from "@tabler/icons-react";
import type { HistoryEntry } from "../wallet/history";

// The kinds of transaction the wallet sends, as the Activity list and the details screen name them.
export function kindOf(entry: HistoryEntry) {
  if (entry.kind === "setSchemes") return { title: "Scheme change", Icon: IconShieldCheck };
  if (entry.kind === "deploy") return { title: "Deployment", Icon: IconRocket };
  if (entry.deploys) return { title: "Deployment and send", Icon: IconRocket };
  return { title: "Send", Icon: IconArrowUpRight };
}
