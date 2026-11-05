import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

// No password hash is stored: AES-GCM's tag check is the password check, so every guess costs a
// full PBKDF2 run. 600k iterations of PBKDF2-SHA256 is OWASP's current recommendation.
const ITERATIONS = 600_000;
const AAD = new TextEncoder().encode("agile-wallet/vault/v1");
const STORAGE_KEY = "vault";

// WebCrypto's types want ArrayBuffer-backed views; noble's helpers return ArrayBufferLike ones.
const view = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

export type Vault = { version: 1; iterations: number; salt: string; iv: string; ciphertext: string };

export class WrongPasswordError extends Error {
  constructor() {
    super("Wrong password");
  }
}

export async function encryptSecret(password: string, secret: Uint8Array): Promise<Vault> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, view(secret));
  return {
    version: 1,
    iterations: ITERATIONS,
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(new Uint8Array(ciphertext)),
  };
}

export async function decryptSecret(password: string, vault: Vault): Promise<Uint8Array> {
  const key = await deriveKey(password, view(hexToBytes(vault.salt)), vault.iterations);
  try {
    const iv = view(hexToBytes(vault.iv));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, view(hexToBytes(vault.ciphertext)));
    return new Uint8Array(plain);
  } catch {
    throw new WrongPasswordError();
  }
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const passwordBytes = new TextEncoder().encode(password);
  try {
    const base = await crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    passwordBytes.fill(0);
  }
}

export async function saveVault(vault: Vault): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: vault });
}

export async function loadVault(): Promise<Vault | undefined> {
  return (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as Vault | undefined;
}
