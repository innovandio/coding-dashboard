import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/eval",
  testMatch: "eval.spec.ts",
  fullyParallel: false,
  retries: 0,
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
