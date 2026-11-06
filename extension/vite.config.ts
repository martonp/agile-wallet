import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Two entry points: the popup page and the MV3 background service worker.
// public/manifest.json is copied to dist/ as is; load dist/ as an unpacked extension.
export default defineConfig({
  plugins: [react()],
  // zknox-falcon is a linked CommonJS package; linked packages are not pre-bundled unless listed.
  optimizeDeps: { include: ["zknox-falcon"] },
  // The signer worker imports modules (and WASM), so it is built as an ES module worker.
  worker: { format: "es" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: "popup.html",
        background: "src/background.ts",
      },
      output: {
        // The manifest refers to background.js by name, so keep entry names unhashed.
        entryFileNames: "[name].js",
      },
    },
  },
});
