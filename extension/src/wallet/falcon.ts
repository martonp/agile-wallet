import createFalcon, { type FalconModule } from "zknox-falcon";

// The encodings FalconVerifier takes (README.md, "Verifiers").
export const FALCON_PUBLIC_KEY_BYTES = 1024; // NTT(h): 512 big-endian 16-bit coefficients
export const FALCON_SIGNATURE_BYTES = 1064; // salt (40) ‖ s2 (512 big-endian 16-bit coefficients)

const PK_LEN = 1 + FALCON_PUBLIC_KEY_BYTES; // 0x09 header ‖ public key
const SK_LEN = 1281;
const SALT_LEN = 40;
const ESIG_LEN = 1 + 1024; // 0x29 header ‖ s2

export function falconPublicKey(seed: Uint8Array): Promise<Uint8Array> {
  return withFalcon(seed, (f, { pk }) => f.HEAPU8.slice(pk + 1, pk + PK_LEN));
}

export function falconSign(seed: Uint8Array, digest: Uint8Array): Promise<Uint8Array> {
  return withFalcon(seed, (f, { sk }) => {
    // Output: length (2) ‖ salt (40) ‖ digest ‖ 0x29 ‖ s2
    const smLen = 2 + SALT_LEN + digest.length + ESIG_LEN;
    const sm = f._malloc(smLen);
    const smLenPtr = f._malloc(8);
    if (f._zknox_crypto_sign(sm, smLenPtr, put(f, digest), BigInt(digest.length), sk) !== 0) {
      throw new Error("Falcon signing failed");
    }
    if (f.HEAPU32[smLenPtr >> 2] !== smLen || f.HEAPU8[sm + smLen - ESIG_LEN] !== 0x29) {
      throw new Error("Unexpected Falcon signature layout");
    }
    const sig = new Uint8Array(FALCON_SIGNATURE_BYTES);
    sig.set(f.HEAPU8.subarray(sm + 2, sm + 2 + SALT_LEN));
    sig.set(f.HEAPU8.subarray(sm + smLen - (ESIG_LEN - 1), sm + smLen), SALT_LEN);
    return sig;
  });
}

// A fresh instance per call: keygen from `seed`, run `use`, then zero the whole WASM memory, which
// held the secret key, the seed and the signing state.
async function withFalcon<T>(seed: Uint8Array, use: (f: FalconModule, keys: { pk: number; sk: number }) => T): Promise<T> {
  const f = await createFalcon();
  try {
    const pk = f._malloc(PK_LEN);
    const sk = f._malloc(SK_LEN);
    if (f._zknox_crypto_sign_keypair_from_seed(pk, sk, put(f, seed), seed.length) !== 0 || f.HEAPU8[pk] !== 0x09) {
      throw new Error("Falcon keygen failed");
    }
    return use(f, { pk, sk });
  } finally {
    f.HEAPU8.fill(0);
  }
}

function put(f: FalconModule, bytes: Uint8Array): number {
  const ptr = f._malloc(bytes.length);
  f.HEAPU8.set(bytes, ptr);
  return ptr;
}
