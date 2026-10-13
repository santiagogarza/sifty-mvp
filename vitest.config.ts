import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
  // tsconfig sets jsx: "preserve" so Next owns the JSX transform in the app
  // build. Vite has no such compiler downstream, so component tests need the
  // transform re-enabled here or every .tsx test fails to parse.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
