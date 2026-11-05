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
