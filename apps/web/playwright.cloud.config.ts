import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./cloud-e2e",
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:3006", channel: "chrome" },
  webServer: {
    command:
      "TQ_DEPLOYMENT=cloud TQ_NEXT_DIST=.next-e2e SUPABASE_URL=https://example.supabase.co SUPABASE_PUBLISHABLE_KEY=authored-test-key TQ_APP_URL=http://127.0.0.1:3006 TQ_API_URL=http://127.0.0.1:9 pnpm exec next start --hostname 127.0.0.1 --port 3006",
    url: "http://127.0.0.1:3006/login",
    reuseExistingServer: false,
  },
});
