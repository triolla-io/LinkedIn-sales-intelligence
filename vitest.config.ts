import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { config } from "dotenv";

// Load .env for integration tests (DATABASE_URL etc)
config();

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        storageQuota: 10000000,
      },
    },
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx", "tests/integration/**/*.test.ts", "scripts/staging/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
