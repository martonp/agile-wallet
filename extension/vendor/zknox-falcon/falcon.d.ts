// The parts of the Emscripten module that src/wallet/falcon.ts uses.
export interface FalconModule {
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _zknox_crypto_sign_keypair_from_seed(pk: number, sk: number, seed: number, seedLen: number): number;
  _zknox_crypto_sign(sm: number, smLen: number, m: number, mLen: bigint, sk: number): number;
  _zknox_crypto_sign_open(m: number, mLen: number, sm: number, smLen: bigint, pk: number): number;
}

declare const createFalcon: () => Promise<FalconModule>;
export default createFalcon;
