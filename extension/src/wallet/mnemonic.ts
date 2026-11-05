import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { entropyToMnemonic, mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

// 256 bits (24 words): Grover's search would cut 128 bits to ~64 against a quantum attacker.
export const ENTROPY_BYTES = 32;

export function generateEntropy(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(ENTROPY_BYTES));
}

// The phrase as a string, only for the one-time backup screen.
export function entropyToPhrase(entropy: Uint8Array): string {
  return entropyToMnemonic(entropy, wordlist);
}

// Throws if a word is unknown or the checksum is wrong.
export function phraseToEntropy(phrase: string): Uint8Array {
  return mnemonicToEntropy(phrase.trim().toLowerCase().split(/\s+/).join(" "), wordlist);
}

const encoder = new TextEncoder();
const WORD_BYTES = wordlist.map((w) => encoder.encode(w));

// The BIP-39 seed (empty passphrase), built from the entropy without ever joining the phrase into
// a JS string, which could not be wiped. English words are ASCII, so NFKD normalisation is a no-op.
export function entropyToSeed(entropy: Uint8Array): Uint8Array {
  const indices = wordIndices(entropy);
  const phrase = new Uint8Array(indices.reduce((n, i) => n + WORD_BYTES[i].length, indices.length - 1));
  let at = 0;
  indices.forEach((i, k) => {
    if (k > 0) phrase[at++] = 0x20;
    phrase.set(WORD_BYTES[i], at);
    at += WORD_BYTES[i].length;
  });
  try {
    return pbkdf2(sha512, phrase, "mnemonic", { c: 2048, dkLen: 64 });
  } finally {
    phrase.fill(0);
    indices.fill(0);
  }
}

// Splits entropy ‖ checksum into 11-bit word indices.
function wordIndices(entropy: Uint8Array): Uint16Array {
  const checksum = sha256(entropy);
  const bits = entropy.length * 8 + entropy.length / 4;
  const bit = (j: number) => {
    const byte = j < entropy.length * 8 ? entropy[j >> 3] : checksum[(j >> 3) - entropy.length];
    return (byte >> (7 - (j & 7))) & 1;
  };
  const indices = new Uint16Array(bits / 11);
  for (let w = 0; w < indices.length; w++) {
    for (let b = 0; b < 11; b++) indices[w] = (indices[w] << 1) | bit(w * 11 + b);
  }
  checksum.fill(0);
  return indices;
}
