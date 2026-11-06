// Signs one digest with one key, off the popup's main thread. The key arrives as a copy, which is zeroed here once
// the signature is made; the caller zeroes its own.
import { ecdsaSign } from "./ecdsa";
import { falconSign } from "./falcon";
import type { Scheme } from "./schemes";
import { sphincsSign } from "./sphincs";

export interface SignRequest {
  scheme: Scheme;
  key: Uint8Array;
  digest: Uint8Array;
}

self.onmessage = async ({ data }: MessageEvent<SignRequest>) => {
  try {
    const signature = await sign(data);
    self.postMessage({ signature });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    data.key.fill(0);
  }
};

function sign({ scheme, key, digest }: SignRequest): Uint8Array | Promise<Uint8Array> {
  if (scheme === "ecdsa") return ecdsaSign(key, digest);
  if (scheme === "falcon") return falconSign(key, digest);
  return sphincsSign(key, digest);
}
