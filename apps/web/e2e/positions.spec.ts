import { test, expect, type Page } from "@playwright/test";
import type { Session } from "../components/replay/types";
async function load(page: Page, name: string) {
  await page.goto("/?page=replay");
  await page.getByRole("button", { name: /Load โปรไฟล์/ }).click();
  await page
    .getByRole("button")
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
  await expect(page.getByTestId("backtest-workspace")).toBeVisible();
}
async function tick(page: Page) {
  const pending = page.waitForResponse(
    (r) => r.url().endsWith("/advance") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "ทีละ Tick", exact: true }).click();
  const response = await pending;
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as Session;
}
test("multiple positions float independently, close on chart, partially bank volume and preserve results on reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let s: Session = await (
    await page.request.post("/api/v1/replay/sessions", {
      data: {
        dataset_id: "demo-tick-e2e",
        workspace: "backtest",
        name: "DEMO multi positions " + Date.now(),
        initial_balance: 1000,
        target_trades: 20,
        point_value: 100,
        goal: "Independent exits",
        start_time: 1735782000,
      },
    })
  ).json();
  for (const side of ["BUY", "SELL"]) {
    const r = await page.request.post(
      `/api/v1/replay/sessions/${s.id}/positions`,
      {
        data: {
          revision: s.revision,
          side,
          order_type: "MARKET",
          entry: side === "BUY" ? 101 : 100,
          sl: side === "BUY" ? 90 : 130,
          tp: side === "BUY" ? 130 : 80,
          lot: side === "BUY" ? 0.1 : 0.2,
        },
      },
    );
    expect(r.ok(), await r.text()).toBeTruthy();
    s = await r.json();
  }
  await load(page, s.name);
  const buy = s.trades[0].id,
    sell = s.trades[1].id;
  await tick(page);
  const buyRow = page.getByTestId(`practice-position-${buy}`),
    sellRow = page.getByTestId(`practice-position-${sell}`);
  await expect(buyRow.getByTestId("position-floating")).toContainText("-10");
  await expect(sellRow.getByTestId("position-floating")).toContainText("-20");
  await tick(page);
  await expect(buyRow.getByTestId("position-floating")).toContainText("+80");
  await expect(sellRow.getByTestId("position-floating")).toContainText("-200");
  await expect(
    page
      .getByTestId(`chart-position-${buy}`)
      .getByTestId("chart-position-floating"),
  ).toContainText("+80");
  await expect(
    page.getByRole("button", { name: "วาง Long Position", exact: true }),
  ).toBeEnabled();
  // A new order can be placed through the form while existing orders stay open.
  await page
    .getByRole("button", { name: "วาง Long Position", exact: true })
    .click();
  await page
    .getByRole("button", { name: "รายละเอียด Position", exact: true })
    .click();
  await page.getByLabel("SL Position").fill("90");
  await page.getByLabel("TP Position").fill("130");
  await page.getByLabel("Lot Position").fill("0.01");

  const created = page.waitForResponse(
    (r) => r.url().endsWith("/positions") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "เปิด Position จำลอง", exact: true })
    .click();
  s = await (await created).json();
  expect(s.trades.map((t) => t.status)).toEqual(["open", "open", "pending"]);
  await page
    .getByRole("button", { name: "ปิด Position #3 บนกราฟ", exact: true })
    .click();
  await expect(
    page.getByTestId(`practice-position-${s.trades[2].id}`),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "ปิดบางส่วน Position #1", exact: true })
    .click();
  const modal = page.getByRole("dialog", { name: "ปิด Position บางส่วน" });
  await expect(modal).toBeVisible();
  await page.getByLabel("Lot ที่ปิดบางส่วน").fill("0.04");
  const partial = page.waitForResponse(
    (r) => r.url().endsWith("/close") && r.request().method() === "POST",
  );
  await modal
    .getByRole("button", { name: "ยืนยันปิดตาม Lot", exact: true })
    .click();
  s = await (await partial).json();
  expect(s.trades[0].remaining_lot).toBeCloseTo(0.06);
  expect(s.accounting?.balance).toBe(1032);
  await expect(buyRow.getByTestId("position-floating")).toContainText("+48");
  await expect(buyRow).toContainText("รับรู้แล้ว +32");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({
    path: "../../docs/screenshots/multi-positions-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.body.scrollWidth <= innerWidth + 1),
    )
    .toBeTruthy();
  await page
    .getByRole("button", { name: "ปิดบางส่วน Position #1", exact: true })
    .click();
  await expect(modal).toBeVisible();
  await expect
    .poll(() => modal.evaluate((el) => getComputedStyle(el).opacity))
    .toBe("1");
  await page.screenshot({
    path: "../../docs/screenshots/multi-positions-mobile.png",
    fullPage: true,
  });
  await modal.getByRole("button", { name: "ปิดหน้าต่าง", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  const closed = page.waitForResponse(
    (r) => r.url().endsWith("/close") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "ปิด Position #2 บนกราฟ", exact: true })
    .click();
  s = await (await closed).json();
  expect(s.trades[1].status).toBe("closed");
  expect(s.trades[0].status).toBe("open");
  await expect(buyRow).toBeVisible();
  await expect(sellRow).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const full = page.waitForResponse(
    (r) => r.url().endsWith("/close") && r.request().method() === "POST",
  );
  await buyRow
    .getByRole("button", { name: "ปิด Position #1 ด้วยมือ", exact: true })
    .click();
  s = await (await full).json();
  expect(s.trades[0].money_pnl).toBeCloseTo(80);
  expect(s.accounting?.balance).toBeCloseTo(880);
  expect(s.stats.trades).toBe(2);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const notice = page.getByTestId(`exit-toast-${buy}`);
  await expect(notice).toContainText("+80 USD");
  await notice.getByRole("button", { name: `รีวิว Position ${buy}` }).click();
  await expect(
    page.getByRole("dialog", { name: "ทบทวนหลังปิด Position" }),
  ).toBeVisible();
  await page
    .getByLabel("Feedback ไม้ถัดไป")
    .fill("Optional feedback after practice");
  await page
    .getByRole("button", { name: "บันทึกการทบทวน", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  s = await (await page.request.get(`/api/v1/replay/sessions/${s.id}`)).json();
  expect(s.trades[0].review?.feedback).toBe("Optional feedback after practice");
  await page.getByRole("tab", { name: /^Closed/ }).click();
  await expect(buyRow).toBeVisible();
  await expect(sellRow).toBeVisible();
  expect(await buyRow.locator("td").nth(4).innerText()).toBe("110");
  await load(page, s.name);
  const saved: Session = await (
    await page.request.get(`/api/v1/replay/sessions/${s.id}`)
  ).json();
  expect(saved.trades).toEqual(s.trades);
  expect(saved.accounting).toEqual(s.accounting);
  expect(errors).toEqual([]);
});
test("every UI-created profile requests a random chart start and Load keeps its saved clock", async ({
  page,
}) => {
  for (let i = 0; i < 2; i++) {
    await page.goto("/?page=replay");
    await page.getByRole("button", { name: /Create โปรไฟล์/ }).click();
    await expect(page.getByText(/สุ่มช่วงกราฟใหม่ทุกครั้ง/)).toBeVisible();
    await page
      .getByLabel("ชื่อโปรไฟล์ Backtest")
      .fill("DEMO random start " + Date.now());
    await page
      .getByLabel("เป้าหมายการฝึก")
      .fill("Practice unfamiliar chart starts");
    await page.getByLabel("Symbol โปรไฟล์").selectOption("DEMO-TICK");
    await page.getByLabel("ชุดข้อมูล Backtest").selectOption("demo-tick-e2e");
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/replay/sessions") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "เริ่ม Backtest", exact: true })
      .click();
    const r = await response;
    expect(r.ok(), await r.text()).toBeTruthy();
    expect(r.request().postDataJSON().start_time).toBeUndefined();
    const s: Session = await r.json();
    expect(s.config.start_policy).toBe("random");
    expect(s.config.initial_cursor).toBe(s.cursor);
    expect(s.cursor).toBeGreaterThan(0);
    expect(s.cursor).toBeLessThan(s.end_cursor);
    await load(page, s.name);
    const resumed: Session = await (
      await page.request.get(`/api/v1/replay/sessions/${s.id}`)
    ).json();
    expect(resumed.cursor).toBe(s.cursor);
    expect(resumed.config.initial_cursor).toBe(s.cursor);
    expect(resumed.replay_time_ms).toBe(s.replay_time_ms);
  }
});

test("Play updates multi-position profit without replacing canvases and close-all waits for the final tick", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let s: Session = await (
    await page.request.post("/api/v1/replay/sessions", {
      data: {
        dataset_id: "demo-tick-e2e",
        workspace: "backtest",
        name: "DEMO live multi P/L " + Date.now(),
        initial_balance: 1000,
        target_trades: 20,
        point_value: 100,
        goal: "Live paper P/L",
        start_time: 1735782000,
      },
    })
  ).json();
  for (const side of ["BUY", "SELL"]) {
    const r = await page.request.post(
      `/api/v1/replay/sessions/${s.id}/positions`,
      {
        data: {
          revision: s.revision,
          side,
          order_type: "MARKET",
          entry: side === "BUY" ? 101 : 100,
          sl: side === "BUY" ? 1 : 1000,
          tp: side === "BUY" ? 1000 : 1,
          lot: 0.01,
        },
      },
    );
    expect(r.ok(), await r.text()).toBeTruthy();
    s = await r.json();
  }
  await load(page, s.name);
  await tick(page);
  const chart = page.getByTestId("replay-chart");
  await expect(chart.locator("canvas")).not.toHaveCount(0);
  const count = await chart.locator("canvas").count();
  await chart
    .locator("canvas")
    .evaluateAll((nodes) =>
      nodes.forEach((node) =>
        node.setAttribute("data-kept-position-canvas", "true"),
      ),
    );
  const quotes: number[] = [],
    floating: number[] = [];
  page.on("response", async (r) => {
    if (r.url().endsWith("/advance") && r.ok()) {
      const v: Session = await r.json();
      quotes.push(v.quote!.bid);
      floating.push(v.trades[0].floating_pnl!);
    }
  });
  await page.route("**/advance", async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 180));
    await route.fulfill({ response });
  });
  await page.getByLabel("ความเร็ว Backtest").selectOption("60");
  await page.getByRole("button", { name: "เล่น Replay", exact: true }).click();
  await expect.poll(() => new Set(quotes).size).toBeGreaterThanOrEqual(3);
  expect(new Set(floating).size).toBeGreaterThanOrEqual(3);
  await expect(
    chart.locator('canvas[data-kept-position-canvas="true"]'),
  ).toHaveCount(count);
  await expect(
    page.getByTestId("practice-positions").getByTestId("position-floating"),
  ).toHaveCount(2);
  // Press while an automatic response is still delayed; the action must use its new revision.
  await page.waitForRequest((r) => r.url().endsWith("/advance"));
  const closed = page.waitForResponse(
    (r) => r.url().endsWith("/close-all") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "ปิดทั้งหมด / ยกเลิกรอเข้า", exact: true })
    .click();
  const r = await closed;
  expect(r.ok(), await r.text()).toBeTruthy();
  s = await r.json();
  expect(s.trades.every((t) => t.status === "closed")).toBeTruthy();
  expect(s.trades[0].exit_price).toBe(s.quote!.bid);
  expect(s.trades[1].exit_price).toBe(s.quote!.ask);
  expect(s.trades[0].decision.exit_time_ms).toBe(
    s.trades[1].decision.exit_time_ms,
  );
  expect(s.accounting?.floating_pnl).toBe(0);
  await expect(
    page.getByRole("button", { name: "เล่น Replay", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("practice-positions")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".exit-toast")).toHaveCount(2);
  await page.getByRole("tab", { name: /^Closed/ }).click();
  await expect(page.getByTestId("position-floating")).toHaveCount(2);
  expect(errors).toEqual([]);
});
