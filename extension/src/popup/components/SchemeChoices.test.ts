import { expect, test } from "vitest";
import { choicesChanged, effectiveSafeguards, ruleChoices } from "./SchemeChoices";
import type { Account } from "../../wallet/account";
import { CONTRACTS } from "../../wallet/network";

const key = CONTRACTS.ecdsaBreakSignal.toLowerCase();
const sphincs = { [key]: "sphincs" as const };

test("a backup that becomes a scheme gives way to the next one, and comes back when the scheme goes", () => {
  expect(effectiveSafeguards(sphincs, ["ecdsa"])[key]).toBe("sphincs");
  expect(effectiveSafeguards(sphincs, ["ecdsa", "sphincs"])[key]).toBe("falcon");
  expect(effectiveSafeguards(sphincs, ["ecdsa", "sphincs", "falcon"])[key]).toBeNull(); // every other scheme required
  expect(effectiveSafeguards({ [key]: null }, ["ecdsa"])[key]).toBeNull();
  expect(ruleChoices(sphincs, ["ecdsa", "sphincs"])).toEqual([{ signal: CONTRACTS.ecdsaBreakSignal, scheme: "falcon" }]);
});

test("a saved backup that is also a scheme shows as a change to make", () => {
  const account: Account = {
    index: 0,
    name: "Account 1",
    owner: "0x" + "11".repeat(20),
    schemes: [
      { scheme: "ecdsa", publicKey: "0x" + "11".repeat(20) },
      { scheme: "sphincs", publicKey: "0xabcd" },
    ],
    rules: [{ signal: CONTRACTS.ecdsaBreakSignal, scheme: "sphincs", publicKey: "0xabcd" }],
  };
  expect(choicesChanged(account, ["ecdsa", "sphincs"], sphincs)).toBe(true);
  expect(ruleChoices(sphincs, ["ecdsa", "sphincs"])[0].scheme).toBe("falcon");
  // With no other backup left, the change is turning the safeguard off.
  expect(choicesChanged(account, ["ecdsa", "falcon", "sphincs"], sphincs)).toBe(true);
  expect(ruleChoices(sphincs, ["ecdsa", "falcon", "sphincs"])).toEqual([]);
});

test("a backup in effect that is the saved one is no change", () => {
  const account: Account = {
    index: 0,
    name: "Account 1",
    owner: "0x" + "11".repeat(20),
    schemes: [{ scheme: "ecdsa", publicKey: "0x" + "11".repeat(20) }],
    rules: [{ signal: CONTRACTS.ecdsaBreakSignal, scheme: "sphincs", publicKey: "0xabcd" }],
  };
  expect(choicesChanged(account, ["ecdsa"], sphincs)).toBe(false);
});
