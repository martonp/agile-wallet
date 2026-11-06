import { type Account, accountCount, deriveAccount, loadAccount, saveAccount, selectAccount } from "./account";
import { deriveSigningKeys, wipeKeys, type SigningKeys } from "./derive";
import { entropyToSeed } from "./mnemonic";
import { type Network, loadNetwork } from "./network";
import type { Scheme } from "./schemes";
import { decryptSecret, encryptSecret, loadVault, saveVault } from "./vault";

// The vault holds the mnemonic's entropy, not the phrase: bytes can be wiped, strings can't. Account 0 (owner and
// public keys of the chosen schemes, or of the schemes its wallet already has on the network, for an imported
// phrase) is stored in the clear next to it. `network: null` skips looking on chain.
export async function createWallet(
  password: string,
  entropy: Uint8Array,
  schemes: Scheme[],
  network?: Network | null,
): Promise<void> {
  const seed = entropyToSeed(entropy);
  try {
    const onchain = network === undefined ? await loadNetwork() : (network ?? undefined);
    await saveAccount(await deriveAccount(seed, schemes, 0, "Account 1", onchain));
  } finally {
    seed.fill(0);
  }
  await saveVault(await encryptSecret(password, entropy));
  await selectAccount(0);
}

// The next account of the same seed. If its wallet is already on `network` (restored from the recovery phrase),
// it gets the schemes the wallet has rather than `schemes`.
export async function addAccount(password: string, name: string, schemes: Scheme[], network?: Network): Promise<Account> {
  const vault = await loadVault();
  if (!vault) throw new Error("No wallet");
  const entropy = await decryptSecret(password, vault);
  let seed: Uint8Array | undefined;
  try {
    seed = entropyToSeed(entropy);
    const account = await deriveAccount(seed, schemes, await accountCount(), name, network);
    await saveAccount(account);
    await selectAccount(account.index);
    return account;
  } finally {
    entropy.fill(0);
    seed?.fill(0);
  }
}

export async function hasWallet(): Promise<boolean> {
  return (await loadVault()) !== undefined && (await loadAccount()) !== undefined;
}

// The only way to reach private keys: decrypt, derive just the keys `schemes` need, run `sign`,
// then zero every secret byte, whether `sign` succeeds or throws. Keys must not outlive `sign`.
// Throws WrongPasswordError if the password is wrong.
export async function withSigningKeys<T>(
  password: string,
  schemes: Scheme[],
  sign: (keys: SigningKeys) => T | Promise<T>,
  account = 0,
): Promise<T> {
  const vault = await loadVault();
  if (!vault) throw new Error("No wallet");
  const entropy = await decryptSecret(password, vault);
  let seed: Uint8Array | undefined;
  let keys: SigningKeys = {};
  try {
    seed = entropyToSeed(entropy);
    keys = deriveSigningKeys(seed, schemes, account);
    return await sign(keys);
  } finally {
    entropy.fill(0);
    seed?.fill(0);
    wipeKeys(keys);
  }
}
