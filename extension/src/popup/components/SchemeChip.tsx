import { IconPlus } from "@tabler/icons-react";
import { SCHEME_INFO, type Scheme } from "../schemes";

// A scheme's colored chip; `off` draws it as a dashed outline instead.
export function SchemeChip({ scheme, off = false }: { scheme: Scheme; off?: boolean }) {
  const { label, Icon } = SCHEME_INFO[scheme];
  const ChipIcon = off ? IconPlus : Icon;
  return (
    <span className={`chip ${off ? "chip-off" : `chip-${scheme}`}`}>
      <ChipIcon size={14} aria-hidden />
      {label}
    </span>
  );
}
