// MV3 service worker. Will own the unlocked keys and talk to the Crypto-Agility sidecar.

chrome.runtime.onInstalled.addListener(() => {
  console.log("Agile Wallet installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ping") sendResponse("pong");
});
