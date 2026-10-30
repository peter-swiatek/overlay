import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

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
    plugins: [react()],
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
