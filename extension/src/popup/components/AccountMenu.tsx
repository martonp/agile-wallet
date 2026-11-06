import { useEffect, useRef, useState } from "react";
import { IconCheck, IconChevronDown, IconPlus } from "@tabler/icons-react";
import { shortAddress } from "../format";
import { type Account, listAccounts, walletAddress } from "../../wallet/account";
import "./AccountMenu.css";

type Props = { current: Account; onSelect: (index: number) => void; onAdd: () => void };

// The account's name as a menu: every account of the wallet, then "Add account".
export function AccountMenu({ current, onSelect, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const menu = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    listAccounts().then(setAccounts);
    // Closes on a click outside the menu, or Escape.
    const onPointer = (e: PointerEvent) => menu.current?.contains(e.target as Node) || setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="account-menu" ref={menu}>
      <button className="account-menu-title" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {current.name}
        <IconChevronDown size={16} aria-hidden />
      </button>
      {open && (
        <div className="account-menu-list" role="menu">
          {accounts.map((account) => (
            <button
              key={account.index}
              className="account-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                if (account.index !== current.index) onSelect(account.index);
              }}
            >
              <span>
                {account.name}
                <span className="mono account-menu-address">{shortAddress(walletAddress(account.owner))}</span>
              </span>
              {account.index === current.index && <IconCheck size={14} aria-label="Selected" />}
            </button>
          ))}
          <button className="account-menu-item" role="menuitem" onClick={onAdd}>
            <span>Add account</span>
            <IconPlus size={14} aria-hidden />
          </button>
        </div>
      )}
    </span>
  );
}
