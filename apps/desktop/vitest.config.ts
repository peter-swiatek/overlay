import { defineConfig } from "vitest/config";

export default defineConfig({
  // apps/desktop has no tsconfig.json, so esbuild would fall back to the classic JSX transform.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
  },
});
