import { IconAtom, IconKey, IconTree } from "@tabler/icons-react";

export type Scheme = "ecdsa" | "falcon" | "sphincs";

export const SCHEMES: Scheme[] = ["ecdsa", "falcon", "sphincs"];

export const SCHEME_INFO = {
  ecdsa: { label: "ECDSA", Icon: IconKey },
  falcon: { label: "Falcon-512", Icon: IconAtom },
  sphincs: { label: "SPHINCS+", Icon: IconTree },
};
