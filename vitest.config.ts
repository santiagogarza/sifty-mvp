import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The app tsconfig leaves JSX for Next to compile (`jsx: preserve`).
  // Vitest has to transform it itself or component imports fail to parse.
  oxc: { jsx: { runtime: "automatic" } },
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
