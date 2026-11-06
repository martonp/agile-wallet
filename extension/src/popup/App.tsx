import { useEffect, useState } from "react";
import { type Account as AccountData, selectAccount, selectedAccount } from "../wallet/account";
import { SCHEME_INFO } from "./schemes";
import { hasWallet } from "../wallet/keyring";
import { Onboarding } from "./screens/Onboarding";
import { Unlock } from "./screens/Unlock";
import { Account } from "./screens/Account";
import { Send } from "./screens/Send";
import { ChangeSchemes } from "./screens/ChangeSchemes";
import { Settings } from "./screens/Settings";
import { AddAccount } from "./screens/AddAccount";

type Screen = "onboarding" | "unlock" | "account" | "send" | "schemes" | "settings" | "addAccount";

// The selected account is read here once and handed to each screen, so a screen keeps acting for the account it
// opened with even if another popup switches accounts meanwhile.
export function App() {
  const [screen, setScreen] = useState<Screen>();
  const [index, setIndex] = useState(0);
  const [notice, setNotice] = useState(""); // shown once on the Account screen, cleared by the next navigation
  const go = (next: Screen) => {
    setNotice("");
    setScreen(next);
  };
  const toAccount = () => go("account");
  const select = async (next: number) => {
    await selectAccount(next);
    setIndex(next);
    go("account");
  };
  // A new account whose wallet was already on chain keeps the schemes it has there, whatever was chosen: say so.
  const created = async (account: AccountData) => {
    await select(account.index);
    if (account.restored) {
      const schemes = account.schemes.map((s) => SCHEME_INFO[s.scheme].label).join(", ");
      setNotice(`This account's wallet is already on chain, so it keeps the schemes it has there: ${schemes}.`);
    }
  };

  useEffect(() => {
    (async () => {
      setIndex(await selectedAccount());
      setScreen((await hasWallet()) ? "account" : "onboarding");
    })();
  }, []);

  switch (screen) {
    case undefined:
      return null;
    case "onboarding":
      return <Onboarding onDone={created} />;
    case "unlock":
      return <Unlock onUnlock={toAccount} onForgot={() => go("onboarding")} />;
    case "account":
      return (
        <Account
          key={index}
          index={index}
          notice={notice}
          onSelect={select}
          onAddAccount={() => go("addAccount")}
          onSend={() => go("send")}
          onSchemes={() => go("schemes")}
          onSettings={() => go("settings")}
          onLock={() => go("unlock")}
        />
      );
    case "send":
      return <Send index={index} onBack={toAccount} />;
    case "schemes":
      return <ChangeSchemes index={index} onBack={toAccount} />;
    case "addAccount":
      return <AddAccount onBack={toAccount} onDone={created} />;
    case "settings":
      return <Settings onBack={toAccount} />;
  }
}
