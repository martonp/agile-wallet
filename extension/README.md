# Agile Wallet extension

Chrome MV3 extension (TypeScript, React, Vite).

```bash
npm install
npm run build   # or `npm run watch` to rebuild on save
```

`src/wallet/sphincs.wasm` is the SPHINCS- C13 signer, built from `sphincs-wasm/` and committed. To
rebuild it (needs Rust with the `wasm32-unknown-unknown` target): `npm run build:sphincs`.

Load it: open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick
`extension/dist`. After a rebuild, press the reload icon on the extension's card.
