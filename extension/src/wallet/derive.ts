import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { HDKey } from "@scure/bip32";
import type { Scheme } from "./schemes";

// Per scheme: ECDSA private key (32 bytes), Falcon keygen seed (48), SPHINCS- C13 keygen seed (32).
export type SigningKeys = Partial<Record<Scheme, Uint8Array>>;

// README.md, "One seed, many keys". Derives only the schemes asked for.
export function deriveSigningKeys(seed: Uint8Array, schemes: Scheme[], account = 0, index = 0): SigningKeys {
  const keys: SigningKeys = {};
  if (schemes.includes("ecdsa")) keys.ecdsa = ecdsaKey(seed, account, index);
  if (schemes.includes("falcon")) keys.falcon = subSeed(seed, "falcon-512", account, index, 48);
  if (schemes.includes("sphincs")) keys.sphincs = subSeed(seed, "sphincs", account, index, 32);
  return keys;
}

export function wipeKeys(keys: SigningKeys) {
  for (const key of Object.values(keys)) key.fill(0);
}

function ecdsaKey(seed: Uint8Array, account: number, index: number): Uint8Array {
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(`m/44'/60'/${account}'/0/${index}`);
  const key = child.privateKey!.slice();
  child.wipePrivateData();
  root.wipePrivateData();
  return key;
}

// HMAC-SHA512(S, "agile-wallet/<label>/" ‖ a ‖ i)[0:length], a and i as 4-byte big-endian.
function subSeed(seed: Uint8Array, label: string, account: number, index: number, length: number): Uint8Array {
  const prefix = new TextEncoder().encode(`agile-wallet/${label}/`);
  const message = new Uint8Array(prefix.length + 8);
  message.set(prefix);
  const view = new DataView(message.buffer);
  view.setUint32(prefix.length, account);
  view.setUint32(prefix.length + 4, index);
  const mac = hmac(sha512, seed, message);
  const out = mac.slice(0, length);
  mac.fill(0);
  return out;
}
