// Measures one valid verification by each raw verifier (ZKNOX falcon8, SphincsC13Asm), as the nested call our
// IVerifier adapter makes to it: that call frame's gasUsed in ethrex's callTracer, the number a per-call gasUsed in
// the ERC-7562 frame trace reports. The Crypto-Agility sidecar falls back to it while ethrex's frame tracer has none.
// (Executed-opcode counts only exist in frame-transaction traces: send-wallet-tx.mjs prints them.)
//
//   node measure-verifier-gas.mjs <rpc url> [runs]
import { readFileSync } from "node:fs";
import { createPublicClient, http, encodeFunctionData, keccak256, toHex } from "viem";
import { falcon, sphincs } from "./signers.mjs";

const [rpcUrl = "http://127.0.0.1:8545", runs = "5"] = process.argv.slice(2);
const client = createPublicClient({ transport: http(rpcUrl) });
const chainId = await client.getChainId();
const deployment = JSON.parse(readFileSync(new URL(`../contracts/deployments/${chainId}.json`, import.meta.url)));

const VERIFY = [{ type: "function", name: "verify", stateMutability: "view", inputs: [{ type: "bytes" }, { type: "bytes32" }, { type: "bytes" }], outputs: [{ type: "bool" }] }];
const lower = (a) => a?.toLowerCase();
const find = (node, to) => (lower(node.to) === lower(to) ? node : (node.calls ?? []).map((c) => find(c, to)).find(Boolean));

async function measure(adapter, verifier, publicKey, digest, signature) {
  const call = { to: adapter, data: encodeFunctionData({ abi: VERIFY, functionName: "verify", args: [publicKey, digest, signature] }), gas: "0xf00000" };
  const calls = await client.request({ method: "debug_traceCall", params: [call, "latest", { tracer: "callTracer" }] });
  if (BigInt(calls.output) !== 1n) throw new Error(`verify did not return true: ${calls.output}`);
  return Number(BigInt(find(calls, verifier).gasUsed));
}

const schemes = [
  ["falcon8", "falconVerifier", falcon],
  ["sphincsC13", "sphincsVerifier", sphincs],
];
const result = {};
for (const [verifier, adapter, make] of schemes) {
  const gas = [];
  for (let i = 0; i < Number(runs); i++) {
    const signer = make(`measure-${i}`);
    const digest = keccak256(toHex(`digest ${i}`));
    gas.push(await measure(deployment[adapter], deployment[verifier], signer.publicKey, digest, await signer.sign(digest)));
  }
  result[verifier] = { address: deployment[verifier], maxGasUsed: Math.max(...gas), gasUsed: gas };
  console.error(verifier, result[verifier]);
}
console.log(JSON.stringify({ chainId, result }, null, 2));
