import { useState } from "react";
import { Onboarding } from "./screens/Onboarding";
import { Unlock } from "./screens/Unlock";
import { Account } from "./screens/Account";
import { Send } from "./screens/Send";
import { ChangeSchemes } from "./screens/ChangeSchemes";

type Screen = "onboarding" | "unlock" | "account" | "send" | "schemes";

// Click-through UI only: screens run on mock data and no button touches keys or the network yet.
export function App() {
  const [screen, setScreen] = useState<Screen>("onboarding");
  const toAccount = () => setScreen("account");

  switch (screen) {
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
