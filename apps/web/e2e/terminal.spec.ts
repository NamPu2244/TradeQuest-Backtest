import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import type { Session } from "../components/replay/types";
async function profile(page: Page, request: APIRequestContext) {
  const rows = Array.from(
    { length: 90 },
    (_, i) =>
      `${1767225600 + i * 300},${i === 31 ? "100.5,101.5,100,101" : i === 32 ? "101,102.5,100.5,102" : i === 33 ? "95,96,94,95" : "100,101,99,100"},10`,
  ).join("\n");
  const d = await (
    await request.post("/api/v1/replay/datasets/import", {
      multipart: {
        file: {
          name: "terminal-test.csv",
          mimeType: "text/csv",
          buffer: Buffer.from("time,open,high,low,close,volume\n" + rows),
        },
        name: "DEMO terminal candles",
        symbol: "DEMO-TERM",
        timeframe: "M5",
        utc_offset_minutes: "0",
      },
    })
  ).json();
  const s: Session = await (
    await request.post("/api/v1/replay/sessions", {
      data: {
        dataset_id: d.id,
        name: "DEMO terminal " + Date.now(),
        workspace: "backtest",
        start_time: 1767225600 + 31 * 300,
        initial_balance: 1000,
        point_value: 100,
        target_trades: 20,
        goal: "Terminal order flow",
      },
    })
  ).json();
  await page.goto("/");
  await page.getByRole("button", { name: /Load โปรไฟล์/ }).click();
  await page
    .getByRole("button")
    .filter({ has: page.getByText(s.name, { exact: true }) })
    .click();
  await expect(page.getByTestId("backtest-workspace")).toBeVisible();
  return s;
}
async function order(page: Page, side: "Buy" | "Sell", sl: string, tp: string) {
  await page
    .getByRole("button", { name: `เปิด ${side} จำลอง`, exact: true })
    .click();
  const modal = page.getByRole("dialog", { name: "รายละเอียด Position" });
  await expect(modal).toBeVisible();
  await expect(page.getByLabel("เหตุผลเข้า Position")).toHaveCount(0);
  await expect(page.getByLabel("อารมณ์ก่อนเข้า Position")).toHaveCount(0);
  await page.getByLabel("SL Position").fill(sl);
  await page.getByLabel("TP Position").fill(tp);
  await page.getByLabel("Lot Position").fill("0.1");
  const r = page.waitForResponse(
    (r) => r.url().endsWith("/positions") && r.request().method() === "POST",
  );
  const submit = page.getByRole("button", {
    name: "เปิด Position จำลอง",
    exact: true,
  });
  await expect(submit).toBeEnabled();
  await submit.click();
  const response = await r;
  expect(response.ok(), await response.text()).toBeTruthy();
  const s: Session = await response.json();
  expect(response.request().postDataJSON().reason).toBeUndefined();
  expect(response.request().postDataJSON().emotion).toBeUndefined();
  await expect(modal).toHaveCount(0);
  return s;
}
async function step(page: Page) {
  const r = page.waitForResponse((r) => r.url().endsWith("/step"));
  await page.getByRole("button", { name: "ทีละแท่ง", exact: true }).click();
  return (await (await r).json()) as Session;
}
test("quote buttons need only price/lot; pending/open/closed tables, exit toast and optional later review", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const paths: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/")) paths.push(new URL(r.url()).pathname);
  });
  const initial = await profile(page, request);
  let s = await order(page, "Buy", "98", "104");
  const id = s.trades[0].id;
  await page.getByRole("tab", { name: /^Pending/ }).click();
  await expect(page.getByTestId(`practice-position-${id}`)).toBeVisible();
  s = await step(page);
  expect(s.trades[0].status).toBe("open");
  await page.getByRole("tab", { name: /^Open/ }).click();
  await expect(
    page
      .getByTestId(`practice-position-${id}`)
      .getByTestId("position-floating"),
  ).toContainText("+5");
  const r = page.waitForResponse((r) => r.url().endsWith("/close"));
  await page
    .getByRole("button", { name: "ปิด Position #1 ด้วยมือ", exact: true })
    .click();
  s = await (await r).json();
  expect(s.accounting?.balance).toBe(1005);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const toast = page.getByTestId(`exit-toast-${id}`);
  await expect(toast).toContainText("ปิดด้วยมือ");
  await expect(toast).toContainText("+5 USD");
  await toast
    .getByRole("button", { name: "ซ่อนแจ้งเตือนปิด Position" })
    .click();
  await expect(toast).toHaveCount(0);
  await page.getByRole("tab", { name: /^Closed/ }).click();
  await page
    .getByTestId(`practice-position-${id}`)
    .getByRole("button", { name: "รีวิว", exact: true })
    .click();
  await page.getByLabel("Feedback ไม้ถัดไป").fill("Review only when I want");
  await page
    .getByRole("button", { name: "บันทึกการทบทวน", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  s = await (await request.get(`/api/v1/replay/sessions/${initial.id}`)).json();
  expect(s.trades[0].decision.reason).toBe("");
  expect(s.trades[0].review?.feedback).toBe("Review only when I want");
  await page.getByRole("tab", { name: /^Open/ }).click();
  await order(page, "Sell", "104", "95");
  await step(page);
  s = await step(page);
  const tp = s.trades[1];
  expect(tp.exit_reason).toBe("TP");
  await expect(page.getByTestId(`exit-toast-${tp.id}`)).toContainText("TP");
  await expect(page.getByTestId(`exit-toast-${tp.id}`)).toContainText(
    "+60 USD",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId(`exit-toast-${tp.id}`)).toHaveCSS(
    "opacity",
    "1",
  );
  await page.screenshot({
    path: "../../docs/screenshots/terminal-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    )
    .toBeTruthy();
  await expect(page.locator(".backtest-topbar")).toHaveCount(1);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.screenshot({
    path: "../../docs/screenshots/terminal-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    paths.every((path) => path.startsWith("/api/v1/replay/")),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
test("stop-loss is a toast, expires automatically, and remains reviewable after loading the profile", async ({
  page,
  request,
}) => {
  const initial = await profile(page, request);
  await order(page, "Buy", "98", "104");
  await step(page);
  await step(page);
  const s = await step(page);
  const t = s.trades[0];
  expect(t.exit_reason).toBe("SL");
  await expect(page.getByTestId(`exit-toast-${t.id}`)).toContainText("-55 USD");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId(`exit-toast-${t.id}`)).toHaveCount(0, {
    timeout: 11000,
  });
  await page.reload();
  await page.getByRole("button", { name: /Load โปรไฟล์/ }).click();
  await page
    .getByRole("button")
    .filter({ has: page.getByText(initial.name, { exact: true }) })
    .click();
  await expect(page.locator(".exit-toast")).toHaveCount(0);
  await page.getByRole("tab", { name: /^Closed/ }).click();
  await page.getByRole("button", { name: "รีวิว", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "ทบทวนหลังปิด Position" }),
  ).toBeVisible();
});
