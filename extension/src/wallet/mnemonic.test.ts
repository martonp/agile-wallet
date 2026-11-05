import { mnemonicToSeedSync } from "@scure/bip39";
import { expect, test } from "vitest";
import { entropyToPhrase, entropyToSeed, generateEntropy, phraseToEntropy } from "./mnemonic";

test("generates 24-word phrases", () => {
  expect(entropyToPhrase(generateEntropy()).split(" ")).toHaveLength(24);
});

test("seed from bytes matches BIP-39 seed from the phrase", () => {
  for (let k = 0; k < 20; k++) {
    const entropy = generateEntropy();
    expect(entropyToSeed(entropy)).toEqual(mnemonicToSeedSync(entropyToPhrase(entropy)));
  }
});

test("handles 12-word imports", () => {
  const phrase = "legal winner thank year wave sausage worth useful legal winner thank yellow";
  expect(entropyToSeed(phraseToEntropy(phrase))).toEqual(mnemonicToSeedSync(phrase));
});

test("phrase round-trips and tolerates messy spacing and case", () => {
  const entropy = generateEntropy();
  const messy = `  ${entropyToPhrase(entropy).toUpperCase().replaceAll(" ", "   ")}\n`;
  expect(phraseToEntropy(messy)).toEqual(entropy);
});

test("rejects a bad checksum", () => {
  expect(() => phraseToEntropy("legal winner thank year wave sausage worth useful legal winner thank thank")).toThrow();
});
