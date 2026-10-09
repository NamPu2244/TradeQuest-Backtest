import { defineConfig, devices } from "@playwright/test";
const dev = process.env.TQ_E2E_DEV === "1";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${dev ? 3005 : 3004}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    channel: "chrome",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
  webServer: {
    command: "bash ../../scripts/e2e_server.sh",
    url: `http://127.0.0.1:${dev ? 3005 : 3004}`,
    timeout: 120000,
    reuseExistingServer: false,
  },
});
