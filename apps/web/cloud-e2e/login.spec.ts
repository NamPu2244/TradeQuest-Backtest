import { test, expect } from "@playwright/test";
test("Cloud requires Login and renders GitHub only, including mobile", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("button", { name: "เข้าสู่ระบบด้วย GitHub" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.screenshot({
    path: "../../docs/screenshots/cloud-login-desktop.png",
  });
  const blocked = await request.get("/api/v1/replay/sessions");
  expect(blocked.status()).toBe(401);
  expect(blocked.headers()["cache-control"]).toContain("no-store");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "เข้าสู่ระบบด้วย GitHub" }),
  ).toBeVisible();
  await page.screenshot({
    path: "../../docs/screenshots/cloud-login-mobile.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("cloud proxy rejects cross-site mutations and never trusts browser bearer or local key", async ({
  request,
}) => {
  expect(
    (
      await request.post("/api/v1/replay/datasets/demo", {
        headers: { Origin: "https://evil.example" },
      })
    ).status(),
  ).toBe(403);
  const forged = await request.get("/api/v1/replay/sessions", {
    headers: { Authorization: "Bearer forged", "X-TradeQuest-Local": "forged" },
  });
  expect(forged.status()).toBe(401);
});
test("GitHub login starts PKCE against Supabase with fixed callback; no provider consent performed", async ({
  page,
}) => {
  let target = "";
  await page.route(
    "https://example.supabase.co/auth/v1/authorize**",
    async (route) => {
      target = route.request().url();
      await route.fulfill({
        status: 200,
        body: "Authored OAuth handoff fixture",
      });
    },
  );
  await page.goto("/login");
  await page.getByRole("button", { name: "เข้าสู่ระบบด้วย GitHub" }).click();
  await expect.poll(() => target).toContain("provider=github");
  const url = new URL(target);
  expect(url.searchParams.get("redirect_to")).toBe(
    "http://127.0.0.1:3006/auth/callback",
  );
  expect(url.searchParams.get("code_challenge_method")).toBe("s256");
  expect(url.searchParams.get("code_challenge")).toBeTruthy();
});
