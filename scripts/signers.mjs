// Key generation and signing for the three verifiers, in the encodings they take. Test keys only: the seeds are
// arguments, and the SPHINCS- signer gets its secret seed on the command line.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toHex } from "viem";

const contracts = fileURLToPath(new URL("../contracts/", import.meta.url));
const SIGNER_C13 = `${contracts}lib/SPHINCS-/signers/signer-wasm/target/release/signer-c13`;

/** ECDSA: publicKey = 20-byte address, signature = r ‖ s ‖ v (v = 27/28). */
export function ecdsa(seed) {
  const privateKey = keccak256(toHex(`ecdsa:${seed}`));
  const account = privateKeyToAccount(privateKey);
  return {
    privateKey,
    address: account.address,
    publicKey: account.address,
    sign: (digest) => account.sign({ hash: digest }),
  };
}

/** Falcon-512 via ZKNOX falcon.js: publicKey = 1024 bytes, signature = salt (40) ‖ s2 (1024). */
export function falcon(seed) {
  const seedHex = keccak256(toHex(`falcon:${seed}`));
  const run = (digest) => execFileSync("node", [`${contracts}test/ffi/falcon_sign.cjs`, seedHex, digest]).toString();
  const publicKey = run(`0x${"00".repeat(32)}`).slice(0, 2 + 2048);
  return { publicKey, sign: (digest) => `0x${run(digest).slice(2 + 2048)}` };
}

/** SPHINCS- C13 via signer-c13: publicKey = pkSeed ‖ pkRoot (64 bytes), signature = 3688 bytes. */
export function sphincs(seed) {
  const key = JSON.parse(execFileSync(SIGNER_C13, ["keygen", keccak256(toHex(`sphincs:${seed}`))], { stdio: ["ignore", "pipe", "ignore"] }));
  return {
    publicKey: `${key.seed}${key.root.slice(2)}`,
    sign: (digest) => execFileSync(SIGNER_C13, ["sign-with", key.seed, key.sk_seed, key.root, digest], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(),
  };
}
