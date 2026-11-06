import type { Scheme } from "./schemes";

// Placeholder account shown until key derivation and the RPC client exist.
export const MOCK_ACCOUNT = {
  name: "Account 1",
  address: "0x7a3F9c2E41b8D06aF5e3C7d1290bA4f8E6d2c91E",
  balance: "1.2500",
  fee: "0.0004",
  schemes: ["ecdsa", "falcon", "sphincs"] as Scheme[],
};

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
