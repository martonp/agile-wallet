import initSphincs from "./sphincs.wasm?init";

// The encodings SphincsVerifier takes (README.md, "Verifiers").
export const SPHINCS_PUBLIC_KEY_BYTES = 64; // pkSeed ‖ pkRoot, 32 bytes each
export const SPHINCS_SIGNATURE_BYTES = 3688;

// sphincs.wasm: the SPHINCS- C13 signer behind a plain C ABI (extension/sphincs-wasm, `npm run build:sphincs`).
interface SphincsExports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  sphincs_public_key(seed: number, out: number): void;
  sphincs_sign(seed: number, digest: number, out: number): number;
}

// The signer crate also exports its wasm-bindgen functions, which are never called; their imports only need to exist.
const stub = (name: string | symbol) => () => {
  throw new Error(`sphincs.wasm called ${String(name)}`);
};
const stubImports = new Proxy({}, { get: () => new Proxy({}, { get: (_, name) => stub(name) }) });

export function sphincsPublicKey(seed: Uint8Array): Promise<Uint8Array> {
  return withSphincs(seed, (s, seedPtr) => {
    const out = s.alloc(SPHINCS_PUBLIC_KEY_BYTES);
    s.sphincs_public_key(seedPtr, out);
    return heap(s).slice(out, out + SPHINCS_PUBLIC_KEY_BYTES);
  });
}

export function sphincsSign(seed: Uint8Array, digest: Uint8Array): Promise<Uint8Array> {
  return withSphincs(seed, (s, seedPtr) => {
    const out = s.alloc(SPHINCS_SIGNATURE_BYTES);
    if (s.sphincs_sign(seedPtr, put(s, digest), out) !== 0) throw new Error("SPHINCS- signing failed");
    return heap(s).slice(out, out + SPHINCS_SIGNATURE_BYTES);
  });
}

// A fresh instance per call: copy in `seed`, run `use`, then zero the whole WASM memory, which held the secret
// key and the signing state.
async function withSphincs<T>(seed: Uint8Array, use: (s: SphincsExports, seedPtr: number) => T): Promise<T> {
  const s = (await initSphincs(stubImports)).exports as unknown as SphincsExports;
  try {
    if (seed.length !== 32) throw new Error("SPHINCS- seed must be 32 bytes");
    return use(s, put(s, seed));
  } finally {
    heap(s).fill(0);
  }
}

// A fresh view each time: the memory's buffer is replaced when it grows.
function heap(s: SphincsExports): Uint8Array {
  return new Uint8Array(s.memory.buffer);
}

function put(s: SphincsExports, bytes: Uint8Array): number {
  const ptr = s.alloc(bytes.length);
  heap(s).set(bytes, ptr);
  return ptr;
}
