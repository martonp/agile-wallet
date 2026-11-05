import { useEffect, useState } from "react";

export function App() {
  const [status, setStatus] = useState("…");

  // Round-trip to the background worker to show the popup and worker are wired up.
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "ping" }).then((reply) => setStatus(reply));
  }, []);

  return (
    <main>
      <h1>Agile Wallet</h1>
      <p>Background: {status}</p>
    </main>
  );
}
