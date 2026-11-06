import { IconAtom, IconKey, IconTree } from "@tabler/icons-react";

export { SCHEMES, type Scheme } from "../wallet/schemes";

export const SCHEME_INFO = {
  ecdsa: { label: "ECDSA", Icon: IconKey },
  falcon: { label: "Falcon-512", Icon: IconAtom },
  sphincs: { label: "SPHINCS-", Icon: IconTree },
};
