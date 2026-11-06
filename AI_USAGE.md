# AI usage

Written to follow the ETHGlobal "Use of AI Tools" rules: where and how AI was used, and which files
it generated or assisted with.

**Tool:** Claude Code (Claude Opus 5.5) in the Claude desktop app.

**How we work:** the human author sets the goals and design constraints, and steers the work in small
commits, testing the results; not every commit was reviewed line by line. Claude does research, proposes
designs and writes most of the code and tests. Commits written with AI assistance carry a
`Co-Authored-By: Claude` trailer.

## Log

| Date | Commit / files | What the human did | What AI did |
|---|---|---|---|
| 2026-11-05 | `README.md`, `AI_USAGE.md` | Defined the project: schemes, verifier interface, `setSchemes` superset rule, VPR mempool idea, key derivation, scope | Read the prize page, AI rules, EIP-8141, the workshop and sidecar repos and ethrex's tracer; drafted the README; found that VPR needs per-call `gasUsed` from ethrex's tracer; a research subagent surveyed Solidity Falcon/SPHINCS verifiers and JS signers |
| 2026-11-05 | `sidecar/` submodule, `contracts/` setup, `IVerifier.sol`, `EcdsaVerifier.sol` + test | Approved forking the sidecar; reviewed commits | Forked the sidecar, set up Foundry, wrote the interface, the ECDSA verifier and its tests |
| 2026-11-05 | `contracts/lib/ETHFALCON`, `FalconVerifier.sol`, `test/FalconVerifier.t.sol`, `test/ffi/falcon_sign.cjs` | Chose ZKNOX's falcon.js signer over a custom conversion | Vendored ETHFALCON, wrote the IVerifier adapter (packs coefficients in assembly) and a parity test that signs with falcon.js through ffi |
| 2026-11-05 | `extension/` skeleton | Asked for an installable extension skeleton | Set up the MV3 extension: Vite + React + TypeScript build, manifest, popup, background worker with a ping round-trip |
| 2026-11-05 | `contracts/lib/SPHINCS-`, `SphincsVerifier.sol`, `test/SphincsVerifier.t.sol` | Chose SPHINCS- C13 | Vendored SPHINCS-, wrote the IVerifier adapter (external self-call in try/catch) and a parity test that signs with the repo's Rust `signer-c13` through ffi |
| 2026-11-05 | `extension/src/popup/` | Picked the Lattice design (scheme-colored chips), light and dark following the browser; cut the mempool row from Send | Drew mockups of the five screens and four design directions, then built the click-through UI on mock data (no keys or network yet) |
| 2026-11-05 | `extension/src/wallet/`, onboarding and Send screens | Specified password-encrypted mnemonic, decrypt-derive-sign-wipe per transaction; accepted the hardening suggestions | Proposed the hardening (no stored hash, PBKDF2 600k + AES-GCM, 24 words against Grover, entropy as wipeable bytes, derive only needed keys); wrote the mnemonic, vault, derivation and keyring modules with tests, and wired create/import/backup and the signing password |
| 2026-11-05 | `contracts/lib/hegota-support`, `AgileWallet.sol`, `AgileWalletFactory.sol`, `test/AgileWallet.t.sol`, `test/mocks/FrameTxMock.sol`, `README.md` | Reviewed drafts before any commit; directed scheme-agnostic schemes, storing only a hash, starting with any subset, and an address from the ECDSA owner only | Drafted the wallet and factory through each revision, the owner-signature check at deployment, mocks for the frame opcodes and the tests |
| 2026-11-05 | `extension/src/wallet/falcon.ts`, `extension/vendor/zknox-falcon`, manifest CSP | Chose falcon.js and asked to integrate Falcon first; kept falcon.js unpatched (no fixing external libraries for the hackathon) | Wrote the signer with tests and a one-off on-chain check against FalconVerifier; found that falcon.js never seeds its signing DRBG, documented as a prototype limitation |
| 2026-11-05 | `extension/src/wallet/ecdsa.ts` | Asked for ECDSA signing next | Wrote the ECDSA signer (owner address; `r ‖ s ‖ v`, low s, for EcdsaVerifier) with tests and a one-off on-chain check against EcdsaVerifier |
| 2026-11-05 | `contracts/script/Deploy.s.sol`, `contracts/deployments/1337.json` | Asked to deploy the contracts on a local devnet and measure the verifiers' gas there | Wrote the CREATE2 deploy script and deployed the contracts on a local copy of the workshop devnet |
| 2026-11-06 | `FalconVerifier.sol`, `SphincsVerifier.sol`, `contracts/script/Deploy.s.sol` | Required the mempool to list the verifiers themselves, not our adapters | Made the adapters call separately deployed ZKNOX `falcon8` and `SphincsC13Asm`, pinned one solc version per artifact so CREATE2 addresses stay fixed, deployed past Amsterdam's state-gas pricing, and cut the Falcon adapter's packing cost with a lane swap |
