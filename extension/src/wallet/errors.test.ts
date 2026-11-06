import { afterEach, expect, test, vi } from "vitest";
import { explain } from "./errors";
import { RpcError, rpc } from "./rpc";
import { WrongPasswordError } from "./vault";

afterEach(() => vi.unstubAllGlobals());

test("an unreachable node is named, not 'Failed to fetch'", async () => {
  vi.stubGlobal("fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  await expect(rpc("http://127.0.0.1:18599", "eth_chainId")).rejects.toThrow("Can't reach 127.0.0.1:18599");
});

test("known mempool refusals are explained; others lose the method name", () => {
  const refused = (reason: string) => new RpcError("eth_sendFrameTransaction", reason);
  expect(explain(refused("validation prefix execution gas sum 1068000 + … exceeds MAX_VERIFY_GAS 100000 + …"))).toMatch(/current VPR build/);
  expect(explain(refused("0xE2aa… cannot cover its pending frame transactions: they would owe 2017… wei"))).toBe(
    "Not enough ETH for the amount plus the network fee.",
  );
  expect(explain(refused("something new"))).toBe("The VPR mempool refused it: something new");
  expect(explain(new RpcError("eth_call", "execution reverted"))).toBe("execution reverted");
  expect(explain(new WrongPasswordError())).toBe("Wrong password. Try again.");
});
