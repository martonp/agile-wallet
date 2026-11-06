// End-to-end demo: sends ETH from an Agile Wallet through the Crypto-Agility sidecar. The first run also deploys the wallet
// (deploy frame + the owner's protocol SECP256K1 signature); later runs reuse it.
//
//   FUNDER_KEY=0x… node send-wallet-tx.mjs [sidecar rpc] [ethrex rpc]
//   env: SEED (default "demo"), SCHEMES (default "falcon,sphincs"; any of ecdsa, falcon, sphincs),
//        RULES: the wallet's current break-signal backups on chain, before this transaction, e.g. "sphincs" (default
//          none; the signal is the deployment's ecdsaBreakSignal); after subscribing, later runs pass them too,
//        SET_RULES to change them with a setRules frame ("" for none),
//        IGNORE_SIGNAL=1 to not sign for raised backups: once the signal is raised, simulation then fails with
//          "missing signature",
//        DRY_RUN=1 to stop after the simulation, which prints the raw verifiers' executed-opcode counts
//
// Test keys only: every key is derived from SEED in the clear.
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, encodeFunctionData, parseEther, formatEther, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getProfile } from "@forshtat/hegota-support/profiles";
import * as tx from "@forshtat/hegota-support/tx";
import { toWire } from "@forshtat/hegota-support/rpc";
import { ecdsa, falcon, sphincs } from "./signers.mjs";

const [sidecarUrl = "http://127.0.0.1:14338/rpc", rpcUrl = "http://127.0.0.1:8545"] = process.argv.slice(2);
const seed = process.env.SEED ?? "demo";
const list = (value) => (value ? value.split(",") : []);
const names = list(process.env.SCHEMES ?? "falcon,sphincs");
const ruleNames = list(process.env.RULES);
const newRuleNames = process.env.SET_RULES === undefined ? undefined : list(process.env.SET_RULES);
const RECIPIENT = "0x8943545177806ED17B9F23F0a21ee5948eCaa776";
const profile = getProfile("ethrex-eip8141-tracer");

const client = createPublicClient({ transport: http(rpcUrl) });
const chainId = await client.getChainId();
const deployment = JSON.parse(readFileSync(new URL(`../contracts/deployments/${chainId}.json`, import.meta.url)));
const rpc = async (url, method, params) => {
  const res = await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();
  if (res.error) throw new Error(`${method}: ${JSON.stringify(res.error)}`);
  return res.result;
};

const SCHEME = { type: "tuple[]", components: [{ name: "verifier", type: "address" }, { name: "publicKey", type: "bytes" }] };
const RULE = { type: "tuple[]", components: [{ name: "signal", type: "address" }, { ...SCHEME, type: "tuple", name: "scheme" }] };
const WALLET_ABI = [
  { type: "function", name: "validate", stateMutability: "nonpayable", inputs: [{ ...SCHEME, name: "current" }, { ...RULE, name: "rules" }], outputs: [] },
  { type: "function", name: "setRules", stateMutability: "nonpayable", inputs: [{ ...RULE, name: "newRules" }], outputs: [] },
];
const SIGNAL_ABI = [{ type: "function", name: "broken", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] }];
const FACTORY_ABI = [
  { type: "function", name: "deploy", stateMutability: "nonpayable", inputs: [{ name: "owner", type: "address" }, { ...SCHEME, name: "initial" }], outputs: [{ type: "address" }] },
  { type: "function", name: "walletAddress", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "address" }] },
];

// ---- keys, schemes, wallet ----------------------------------------------------------------------------------
const owner = ecdsa(seed);
// ECDSA is native: verifier address(0), signed with a protocol SECP256K1 entry.
const signers = { ecdsa: [zeroAddress, owner], falcon: [deployment.falconVerifier, falcon(seed)], sphincs: [deployment.sphincsVerifier, sphincs(seed)] };
for (const n of [...names, ...ruleNames, ...(newRuleNames ?? [])]) if (!signers[n]) throw new Error(`unknown scheme ${n}`);
const schemeOf = (n) => ({ verifier: signers[n][0], publicKey: signers[n][1].publicKey });
const schemes = names.map(schemeOf);
const ruleOf = (n) => ({ signal: deployment.ecdsaBreakSignal, scheme: schemeOf(n) });
const rules = ruleNames.map(ruleOf);
const raised = rules.length > 0 && !process.env.IGNORE_SIGNAL && (await client.readContract({ address: deployment.ecdsaBreakSignal, abi: SIGNAL_ABI, functionName: "broken" }));
// The wallet's order: its schemes, the backups of raised rules, then the backups a setRules frame adds. Deduped by
// name, which is by key too: SEED gives one key per name.
const required = [...new Set([...names, ...(raised ? ruleNames : []), ...(newRuleNames ?? [])])];
const chosen = required.map((n) => ({ native: n === "ecdsa", signer: signers[n][1] }));

const wallet = await client.readContract({ address: deployment.factory, abi: FACTORY_ABI, functionName: "walletAddress", args: [owner.address] });
const deployed = ((await client.getCode({ address: wallet })) ?? "0x") !== "0x";
console.log(`wallet ${wallet} (owner ${owner.address}), ${deployed ? "deployed" : "not deployed yet"}, schemes: ${names.join(", ")}, signing: ${required.join(", ")}`);

if ((await client.getBalance({ address: wallet })) < parseEther("0.01")) {
  if (!process.env.FUNDER_KEY) throw new Error("the wallet needs ETH: set FUNDER_KEY");
  const funder = createWalletClient({ account: privateKeyToAccount(process.env.FUNDER_KEY), transport: http(rpcUrl), chain: { id: chainId, name: "devnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } } });
  const hash = await funder.sendTransaction({ to: wallet, value: parseEther("0.1") });
  await client.waitForTransactionReceipt({ hash });
  console.log(`funded with 0.1 ETH (${hash})`);
}

// ---- the frame transaction ----------------------------------------------------------------------------------
const nonce = BigInt(await client.getTransactionCount({ address: wallet }));
function build({ deployGas, verifyGas }) {
  const frames = [];
  if (!deployed) {
    frames.push(tx.frame(profile, "DEFAULT", { target: deployment.factory, execution: deployGas, state: 300_000n, data: encodeFunctionData({ abi: FACTORY_ABI, functionName: "deploy", args: [owner.address, schemes] }) }));
  }
  frames.push(tx.frame(profile, "VERIFY", { scope: "EXECUTION_AND_PAYMENT", target: null, execution: verifyGas, data: encodeFunctionData({ abi: WALLET_ABI, functionName: "validate", args: [schemes, rules] }) }));
  if (newRuleNames) {
    // State gas for storing the rules hash in a slot that was empty.
    frames.push(tx.frame(profile, "SENDER", { target: null, execution: 200_000n, state: 200_000n, data: encodeFunctionData({ abi: WALLET_ABI, functionName: "setRules", args: [newRuleNames.map(ruleOf)] }) }));
  }
  frames.push(tx.frame(profile, "SENDER", { target: RECIPIENT, execution: 50_000n, state: 200_000n, value: parseEther("0.001") }));
  const signatures = chosen.map((c) => (c.native ? tx.secp256k1Placeholder(profile, c.signer.address) : { scheme: tx.sigScheme(profile, "ARBITRARY"), signer: "0x", msg: "0x", signature: "0x" }));
  // The owner authorises the deployment with a SECP256K1 entry; an ECDSA scheme's entry by the owner does too.
  if (!deployed && !required.includes("ecdsa")) signatures.push(tx.secp256k1Placeholder(profile, owner.address));
  return tx.newTx({ chainId, sender: wallet, nonceSeq: nonce, frames, signatures, fees: { maxFeePerGas: 2_000_000_000n } });
}

async function sign(unsigned) {
  const hash = tx.sigHash(profile, unsigned);
  const signatures = [...unsigned.signatures];
  for (let i = 0; i < chosen.length; i++) if (!chosen[i].native) signatures[i] = { ...signatures[i], signature: await chosen[i].signer.sign(hash) };
  let signed = { ...unsigned, signatures };
  for (let i = 0; i < signatures.length; i++) {
    if (signatures[i].scheme === tx.sigScheme(profile, "SECP256K1")) signed = await tx.signTx(profile, signed, (chosen[i]?.signer ?? owner).privateKey, i);
  }
  return signed;
}

// Simulate with generous limits, then declare each prefix frame's measured gas plus a margin.
const probe = await rpc(rpcUrl, "ethrex_simulateFrameTransaction", [tx.encodeTx(profile, await sign(build({ deployGas: 1_000_000n, verifyGas: 3_000_000n }))), "latest", { trace: true }]);
if (!probe.frames) throw new Error(`simulation failed: ${probe.executionError}`);

// The raw verifiers' calls as the sidecar sees them in the ERC-7562 trace.
const opcodes = (n) => Object.values(n.usedOpcodes ?? {}).reduce((a, b) => a + b, 0) + (n.calls ?? []).reduce((a, c) => a + opcodes(c), 0);
const listed = { [deployment.falcon8.toLowerCase()]: "falcon8", [deployment.sphincsC13.toLowerCase()]: "sphincsC13" };
const report = (n) => (listed[n.to?.toLowerCase()] ? [`${listed[n.to.toLowerCase()]}: ${opcodes(n)} opcodes, outOfGas ${n.outOfGas}, gasUsed ${n.gasUsed ?? "not reported"}`] : (n.calls ?? []).flatMap(report));
for (const entry of probe.erc7562Trace ?? []) for (const line of report(entry.root)) console.log(`trace frame ${entry.frameIndex}: ${line}`);
const used = probe.frames.map((f) => BigInt(f.gasUsed));
const margin = (g) => g + g / 50n + 2_000n;
// Re-signing changes the Falcon signature, whose hash-to-point needs 8 or 9 SHAKE blocks (~48k gas apart):
// cover the expensive case. The sidecar's Falcon credit absorbs the extra limit.
const falconMargin = required.includes("falcon") ? 60_000n : 0n;
const verifyGas = (g) => margin(g) + falconMargin;
const limits = deployed ? { deployGas: 0n, verifyGas: verifyGas(used[0]) } : { deployGas: margin(used[0]), verifyGas: verifyGas(used[1]) };
console.log(`simulated gas per frame: ${used.join(", ")}; declared deploy ${limits.deployGas}, verify ${limits.verifyGas}`);
if (process.env.DRY_RUN) process.exit(0);

const signed = await sign(build(limits));
const hash = tx.txHash(profile, signed);
console.log(`sending ${hash} to the Crypto-Agility sidecar`);
console.log("accepted:", await rpc(sidecarUrl, "eth_sendFrameTransaction", [toWire(signed)]));

for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const receipt = await rpc(rpcUrl, "eth_getTransactionReceipt", [hash]);
  if (receipt) {
    const frames = (receipt.frameReceipts ?? []).map((f) => `${f.status === "0x1" ? "ok" : "FAILED"} ${BigInt(f.gasUsed)}`);
    console.log(`mined in block ${BigInt(receipt.blockNumber)}: frames [${frames.join(", ")}]; wallet balance ${formatEther(await client.getBalance({ address: wallet }))} ETH`);
    process.exit(0);
  }
}
throw new Error("not mined within 120 s");
