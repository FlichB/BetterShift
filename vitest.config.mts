import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "node",
    include: ["lib/**/__tests__/**/*.test.ts"],
    setupFiles: ["tests/setup/db.ts"], // [fork]
    // Duty start times are local wall-clock times; pin the zone the server runs in.
    env: { TZ: "Europe/Vienna" },
  },
});
