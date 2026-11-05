import { expect, test } from "vitest";
import { decryptSecret, encryptSecret, WrongPasswordError } from "./vault";

const secret = new Uint8Array(32).map((_, i) => i);

test("decrypts with the right password", async () => {
  const vault = await encryptSecret("correct horse", secret);
  expect(await decryptSecret("correct horse", vault)).toEqual(secret);
});

test("rejects a wrong password", async () => {
  const vault = await encryptSecret("correct horse", secret);
  await expect(decryptSecret("wrong horse", vault)).rejects.toBeInstanceOf(WrongPasswordError);
});

test("uses a fresh salt and IV each time", async () => {
  const [a, b] = [await encryptSecret("pw", secret), await encryptSecret("pw", secret)];
  expect(a.salt).not.toBe(b.salt);
  expect(a.iv).not.toBe(b.iv);
  expect(a.ciphertext).not.toBe(b.ciphertext);
});
