import { deriveSigningKeys, wipeKeys, type SigningKeys } from "./derive";
import { entropyToSeed } from "./mnemonic";
import type { Scheme } from "./schemes";
import { decryptSecret, encryptSecret, loadVault, saveVault } from "./vault";

// The vault holds the mnemonic's entropy, not the phrase: bytes can be wiped, strings can't.
export async function createWallet(password: string, entropy: Uint8Array): Promise<void> {
  await saveVault(await encryptSecret(password, entropy));
}

export async function hasWallet(): Promise<boolean> {
  return (await loadVault()) !== undefined;
}

// The only way to reach private keys: decrypt, derive just the keys `schemes` need, run `sign`,
// then zero every secret byte, whether `sign` succeeds or throws. Keys must not outlive `sign`.
// Throws WrongPasswordError if the password is wrong.
export async function withSigningKeys<T>(
  password: string,
  schemes: Scheme[],
  sign: (keys: SigningKeys) => T | Promise<T>,
): Promise<T> {
  const vault = await loadVault();
  if (!vault) throw new Error("No wallet");
  const entropy = await decryptSecret(password, vault);
  let seed: Uint8Array | undefined;
  let keys: SigningKeys = {};
  try {
    seed = entropyToSeed(entropy);
    keys = deriveSigningKeys(seed, schemes);
    return await sign(keys);
  } finally {
    entropy.fill(0);
    seed?.fill(0);
    wipeKeys(keys);
  }
}
