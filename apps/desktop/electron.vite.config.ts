import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";

/** Dev only: lets the React refresh preamble (an inline script) run. Production HTML is untouched. */
function relaxDevCsp(): Plugin {
  return {
    name: "relax-dev-csp",
    apply: "serve",
    transformIndexHtml: (html) =>
      html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
  };
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve("src/main/index.ts") },
      },
    },
  },
  preload: {
    build: {
      // A sandboxed preload cannot be an ES module, so emit CommonJS (.cjs).
      rollupOptions: {
        input: { index: resolve("src/preload/index.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    plugins: [react(), relaxDevCsp()],
    build: {
      rollupOptions: {
        input: {
          settings: resolve("src/renderer/settings/index.html"),
          overlay: resolve("src/renderer/overlay/index.html"),
        },
      },
    },
  },
});
