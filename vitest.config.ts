import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts", "src/**/*.test.ts"],
    // Integration tests boot an in-memory Postgres (PGlite) per file.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "forks",
    env: {
      SIGNAL_AI_PROVIDER: "dev",
      SESSION_SECRET: "test-session-secret-test-session-secret",
      N8N_WEBHOOK_SECRET: "",
      N8N_OUTBOUND_WEBHOOK_URL: "",
    },
  },
});
