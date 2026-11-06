import { ecdsaSign } from "./ecdsa";
import { falconSign } from "./falcon";
import type { Scheme } from "./schemes";
import type { SignRequest } from "./signer.worker";
import { sphincsSign } from "./sphincs";

// Signs in a Web Worker, so the popup keeps painting while SPHINCS- takes seconds. One worker per signature,
// terminated after it, so no key outlives the signature there either. Where there are no workers (the tests),
// it signs here.
export function signOffThread(scheme: Scheme, key: Uint8Array, digest: Uint8Array): Promise<Uint8Array> {
  if (typeof Worker === "undefined") return signHere({ scheme, key, digest });
  const worker = new Worker(new URL("./signer.worker.ts", import.meta.url), { type: "module" });
  return new Promise<Uint8Array>((resolve, reject) => {
    worker.onmessage = ({ data }: MessageEvent<{ signature?: Uint8Array; error?: string }>) =>
      data.signature ? resolve(data.signature) : reject(new Error(data.error ?? "Signing failed"));
    worker.onerror = (e) => reject(new Error(e.message || "Signing failed"));
    worker.postMessage({ scheme, key, digest } satisfies SignRequest);
  }).finally(() => worker.terminate());
}

async function signHere({ scheme, key, digest }: SignRequest): Promise<Uint8Array> {
  if (scheme === "ecdsa") return ecdsaSign(key, digest);
  if (scheme === "falcon") return falconSign(key, digest);
  return sphincsSign(key, digest);
}
