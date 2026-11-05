import { useEffect, useState } from "react";
import { hasWallet } from "../wallet/keyring";
import { Onboarding } from "./screens/Onboarding";
import { Unlock } from "./screens/Unlock";
import { Account } from "./screens/Account";
import { Send } from "./screens/Send";
import { ChangeSchemes } from "./screens/ChangeSchemes";

type Screen = "onboarding" | "unlock" | "account" | "send" | "schemes";

// Account data is still mock; only wallet creation and the signing password are real so far.
export function App() {
  const [screen, setScreen] = useState<Screen>();
  const toAccount = () => setScreen("account");

  useEffect(() => {
    hasWallet().then((has) => setScreen(has ? "account" : "onboarding"));
  }, []);

  switch (screen) {
    case undefined:
      return null;
    case "onboarding":
      return <Onboarding onDone={toAccount} />;
    case "unlock":
      return <Unlock onUnlock={toAccount} onForgot={() => setScreen("onboarding")} />;
    case "account":
      return (
        <Account onSend={() => setScreen("send")} onSchemes={() => setScreen("schemes")} onLock={() => setScreen("unlock")} />
      );
    case "send":
      return <Send onBack={toAccount} />;
    case "schemes":
      return <ChangeSchemes onBack={toAccount} />;
  }
}
