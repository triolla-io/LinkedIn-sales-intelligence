import { defineConfig } from "vite";

/**
 * Standalone build of the content script — ONE self-contained IIFE, no dynamic import.
 *
 * The crxjs build emits a tiny loader that `import()`s the real module at runtime. That is
 * the piece that can silently fail to come up (a page with a strict CSP, or a tab that
 * loaded while the extension was reloading), and when it does, every page call comes back
 * "Receiving end does not exist" with nothing to catch. This bundle has no such moving
 * part, so background.ts can inject it directly with chrome.scripting as a recovery.
 *
 * Runs after the crxjs build with emptyOutDir:false so it lands beside it in dist/.
 */
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: "src/content.ts",
      formats: ["iife"],
      name: "TriollaContentScript",
      fileName: () => "content-standalone.js",
    },
    rollupOptions: { output: { inlineDynamicImports: true, extend: true } },
  },
});
