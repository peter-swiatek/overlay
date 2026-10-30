import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";
import { resolveBuildInfo } from "./scripts/version.mjs";

/** Dev only: lets the React refresh preamble (an inline script) run. Production HTML is untouched. */
function relaxDevCsp(): Plugin {
  return {
    name: "relax-dev-csp",
    apply: "serve",
    transformIndexHtml: (html) =>
      html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
  };
}

/** Build identity from OVERLAY_* env (set by CI) or a local default; see scripts/version.mjs. */
const buildInfo = resolveBuildInfo();

export default defineConfig({
  main: {
    // One define covers every main-process entry (main, capture, telemetry).
    define: { __OVERLAY_BUILD__: JSON.stringify(buildInfo) },
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          capture: resolve("src/capture/capture-process.ts"),
          telemetry: resolve("src/telemetry/telemetry-process.ts"),
          "telemetry-session-worker": resolve("src/telemetry/session-worker.ts"),
        },
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
