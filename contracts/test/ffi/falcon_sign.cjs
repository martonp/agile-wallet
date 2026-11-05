// Signs with ZKNOX's falcon.js for FalconVerifier.t.sol (via vm.ffi).
// Usage: node falcon_sign.cjs <seed hex, >= 32 bytes> <digest hex, 32 bytes>
// Prints 0x ‖ publicKey (1024 bytes) ‖ salt (40 bytes) ‖ s2 (1024 bytes), headers stripped.
const Module = require("../../lib/ETHFALCON/falcon/falcon.js");

const PK_LEN = 1025; // 0x09 ‖ NTT(h), 512 × 16 bits
const SK_LEN = 1281;
const SIG_LEN = 1025; // 0x29 ‖ s2, 512 × 16 bits

const hex = (s) => Buffer.from(s.replace(/^0x/, ""), "hex");
const [seed, digest] = process.argv.slice(2).map(hex);

Module().then((falcon) => {
  const put = (buf) => {
    const ptr = falcon._malloc(buf.length);
    falcon.HEAPU8.set(buf, ptr);
    return ptr;
  };
  const get = (ptr, len) => Buffer.from(falcon.HEAPU8.subarray(ptr, ptr + len));

  const pk = falcon._malloc(PK_LEN);
  const sk = falcon._malloc(SK_LEN);
  if (falcon._zknox_crypto_sign_keypair_from_seed(pk, sk, put(seed), seed.length) !== 0) throw new Error("keygen");

  // crypto_sign output: sigLen (2 bytes) ‖ salt (40) ‖ message ‖ 0x29 ‖ s2
  const outLen = 2 + 40 + digest.length + SIG_LEN;
  const out = falcon._malloc(outLen);
  const outLenPtr = falcon._malloc(8);
  if (falcon._zknox_crypto_sign(out, outLenPtr, put(digest), BigInt(digest.length), sk) !== 0) throw new Error("sign");
  const signed = get(out, outLen);

  const salt = signed.subarray(2, 42);
  const s2 = signed.subarray(42 + digest.length + 1);
  process.stdout.write("0x" + Buffer.concat([get(pk + 1, PK_LEN - 1), salt, s2]).toString("hex"));
});
