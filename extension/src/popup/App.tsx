import { useEffect, useState } from "react";
import { selectAccount, selectedAccount } from "../wallet/account";
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
  const toAccount = () => setScreen("account");
  const select = async (next: number) => {
    await selectAccount(next);
    setIndex(next);
    setScreen("account");
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
      return <Onboarding onDone={() => select(0)} />;
    case "unlock":
      return <Unlock onUnlock={toAccount} onForgot={() => setScreen("onboarding")} />;
    case "account":
      return (
        <Account
          key={index}
          index={index}
          onSelect={select}
          onAddAccount={() => setScreen("addAccount")}
          onSend={() => setScreen("send")}
          onSchemes={() => setScreen("schemes")}
          onSettings={() => setScreen("settings")}
          onLock={() => setScreen("unlock")}
        />
      );
    case "send":
      return <Send index={index} onBack={toAccount} />;
    case "schemes":
      return <ChangeSchemes index={index} onBack={toAccount} />;
    case "addAccount":
      return <AddAccount onBack={toAccount} onDone={select} />;
    case "settings":
      return <Settings onBack={toAccount} />;
  }
}
