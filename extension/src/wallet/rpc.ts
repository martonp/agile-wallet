// A JSON-RPC call. Throws RpcError with the node's message, or a plain sentence when the node can't be reached.
export async function rpc<T = unknown>(url: string, method: string, params: unknown[] = []): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch {
    throw new Error(`Can't reach ${hostOf(url)}`);
  }
  if (!res.ok) throw new Error(`${hostOf(url)} answered with an error (HTTP ${res.status})`);
  const body = await res.json();
  if (body.error) throw new RpcError(method, body.error.message ?? JSON.stringify(body.error));
  return body.result as T;
}

// A node's refusal: `reason` is its text, without the method.
export class RpcError extends Error {
  constructor(
    readonly method: string,
    readonly reason: string,
  ) {
    super(`${method}: ${reason}`);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
