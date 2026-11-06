import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { mnemonicToSeedSync } from "@scure/bip39";
import { expect, test } from "vitest";
import { deriveSigningKeys, wipeKeys } from "./derive";

// Hardhat/Foundry's default mnemonic: its m/44'/60'/0'/0/0 key is widely published.
const seed = mnemonicToSeedSync("test test test test test test test test test test test junk");

test("ECDSA follows BIP-32 m/44'/60'/a'/0/i", () => {
  const { ecdsa } = deriveSigningKeys(seed, ["ecdsa"]);
  expect(bytesToHex(ecdsa!)).toBe("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
});

test("accounts are the hardened account level, m/44'/60'/a'/0/0", () => {
  // cast wallet private-key --mnemonic "test … junk" --mnemonic-derivation-path "m/44'/60'/1'/0/0"
  const { ecdsa } = deriveSigningKeys(seed, ["ecdsa"], 1);
  expect(bytesToHex(ecdsa!)).toBe("7797c0f3db8b946604ec2039dfd9763e4ffdc53174342a2ed9b14fa3eda666a5");
});

test("Falcon and SPHINCS+ sub-seeds are HMAC-SHA512 prefixes with big-endian a and i", () => {
  const keys = deriveSigningKeys(seed, ["falcon", "sphincs"], 1, 2);
  const msg = (label: string) => new Uint8Array([...new TextEncoder().encode(`agile-wallet/${label}/`), 0, 0, 0, 1, 0, 0, 0, 2]);
  expect(keys.falcon).toEqual(hmac(sha512, seed, msg("falcon-512")).slice(0, 48));
  expect(keys.sphincs).toEqual(hmac(sha512, seed, msg("sphincs")).slice(0, 32));
});

test("derives only the schemes asked for", () => {
  expect(Object.keys(deriveSigningKeys(seed, ["falcon"]))).toEqual(["falcon"]);
});

test("wipeKeys zeroes every key", () => {
  const keys = deriveSigningKeys(seed, ["ecdsa", "falcon", "sphincs"]);
  wipeKeys(keys);
  for (const key of Object.values(keys)) expect(key.every((b) => b === 0)).toBe(true);
});
