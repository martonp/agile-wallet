import type { ReactNode } from "react";
import { IconArrowLeft } from "@tabler/icons-react";

export function Header({ title, onBack, children }: { title: string; onBack?: () => void; children?: ReactNode }) {
  return (
    <div className="header">
      <span className="row" style={{ alignItems: "center" }}>
        {onBack && (
          <button className="icon-button" onClick={onBack} aria-label="Back">
            <IconArrowLeft size={18} />
          </button>
        )}
        {title}
      </span>
      {children}
    </div>
  );
}
