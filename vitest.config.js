import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["backend/server/**/*.test.js", "backend/shared/**/*.test.js", "backend/migrations/**/*.test.js", "frontend/src/**/*.test.js"]
  }
});
