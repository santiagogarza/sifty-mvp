import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig sets `jsx: preserve` for Next; component tests (.test.tsx) need
  // JSX compiled to real calls. The React plugin handles that for the test
  // transform only, so the Next build is unaffected.
  plugins: [react()],
  test: {
    // Default to node — most tests are server logic, jose / Buffer / Uint8Array
    // checks misbehave under jsdom because realm-bound globals don't match.
    // Component tests opt into jsdom via the `// @vitest-environment jsdom`
    // pragma at the top of the file.
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
