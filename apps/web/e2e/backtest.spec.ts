import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { Dataset, Session } from "../components/replay/types";
async function data(request: APIRequestContext, varied = false) {
  const rows = Array.from({ length: 90 }, (_, i) =>
    varied
      ? (() => {
          const open = 100 + Math.sin(i * 0.5) * 0.8,
            close = 100 + Math.sin((i + 1) * 0.5) * 0.8;
          return `${1767225600 + i * 300},${open.toFixed(5)},${(Math.max(open, close) + 0.15).toFixed(5)},${(Math.min(open, close) - 0.15).toFixed(5)},${close.toFixed(5)},${10 + (i % 12)}`;
        })()
      : i === 31
        ? `${1767225600 + i * 300},100.5,101.5,100,101,10`
        : i === 32
          ? `${1767225600 + i * 300},101,102.5,100.5,102,10`
          : i === 33
            ? `${1767225600 + i * 300},95,96,94,95,10`
            : i === 60
              ? `${1767225600 + i * 300},777,778,776,777,10`
              : `${1767225600 + i * 300},100,101,99,100,10`,
  ).join("\n");
  const r = await request.post("/api/v1/replay/datasets/import", {
    multipart: {
      file: {
        name: "backtest-demo.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("time,open,high,low,close,volume\n" + rows),
      },
      name: "DEMO DATA · Backtest history",
      symbol: "TEST",
      timeframe: "M5",
      utc_offset_minutes: "0",
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as Dataset;
}
async function create(page: Page, d: Dataset, name: string) {
  await page.route("**/api/v1/replay/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON();
    return route.continue({
      postData: JSON.stringify({ ...body, start_time: 1767225600 + 31 * 300 }),
    });
  });
  await page.goto("/?page=replay");
  await page.getByRole("button", { name: /Create โปรไฟล์/ }).click();
  await page.getByLabel("ชื่อโปรไฟล์ Backtest").fill(name);
  await page.getByLabel("เงินเริ่มต้นจำลอง").fill("1000");
  await page.getByLabel("จำนวนครั้งที่จะเทรด").fill("2");
  await page.getByLabel("Symbol โปรไฟล์").selectOption(d.symbol);
  await page.getByLabel("ชุดข้อมูล Backtest").selectOption(d.id);
  await page
    .getByLabel("เป้าหมายการฝึก")
    .fill("จดอารมณ์และรอจังหวะเข้าให้ครบสองไม้");
  await page.getByLabel("มูลค่าต่อหนึ่งหน่วยราคา").fill("100");
  await page.getByText("ช่วงเวลาและต้นทุนจำลอง", { exact: true }).click();
  await page.getByLabel("Commission Backtest").fill("0.1");
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/replay/sessions") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "เริ่ม Backtest", exact: true })
    .click();
  const s = (await (await response).json()) as Session;
  await expect(page.getByTestId("backtest-workspace")).toBeVisible();
  return s;
}
test("mobile profile, drawing and user-selected indicators fit the screen", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  const d = await data(request);
  await create(page, d, "DEMO DATA · Mobile profile");
  await page
    .getByRole("button", { name: "แนวรับ/ต้าน Backtest", exact: true })
    .click();
  await page.getByTestId("replay-chart").click({ position: { x: 70, y: 180 } });
  await expect(
    page.getByRole("button", { name: "ภาพวาด (1)", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "อินดิเคเตอร์", exact: true }).click();
  await page.getByLabel("อินดิเคเตอร์ Backtest").selectOption("MACD");
  await page
    .getByRole("button", { name: "เพิ่มอินดิเคเตอร์บนกราฟ", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "วาง Short Position", exact: true })
    .click();
  await page
    .getByRole("button", { name: "รายละเอียด Position", exact: true })
    .click();
  await expect(page.getByLabel("Entry Position")).toBeVisible();
  await page.getByRole("button", { name: "ปิดหน้าต่าง", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../../docs/screenshots/backtest-mobile.png",
    fullPage: true,
  });
});
test("chart workspace with position box matches desktop layout without default indicators", async ({
  page,
  request,
}) => {
  const d = (await (
    await request.post("/api/v1/replay/datasets/demo")
  ).json()) as Dataset;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await create(page, d, "DEMO DATA · ฝึกเทรดอย่างมีสติ");
  await page
    .getByRole("button", { name: "วาง Long Position", exact: true })
    .click();
  await expect(page.getByTestId("position-overlay")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../../docs/screenshots/backtest-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("drawing preview follows the pointer; endpoints, move, styling, locking and delete persist without tick redraw", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const d = await data(request),
    initial = await create(page, d, "DEMO DATA · Drawing interaction");
  const canvas = page.getByTestId("replay-chart");
  const box = (await canvas.boundingBox())!;
  let writes = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/visuals") && r.method() === "PUT") writes++;
  });
  await page
    .getByRole("button", { name: "Trendline Backtest", exact: true })
    .click();
  const start = { x: box.x + box.width * 0.32, y: box.y + 140 };
  const end = { x: box.x + box.width * 0.56, y: box.y + 200 };
  await page.mouse.click(start.x, start.y);
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await expect(page.getByTestId("drawing-preview")).toBeVisible();
  const preview = page.getByTestId("drawing-preview").locator("line").first();
  expect(Number(await preview.getAttribute("x2"))).toBeGreaterThan(
    Number(await preview.getAttribute("x1")),
  );
  expect(writes).toBe(0);
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/visuals") && r.ok(),
  );
  await page.mouse.click(end.x, end.y);
  let state: Session = await (await saved).json();
  const id = state.drawings[0].id;
  const shape = page.getByTestId(`drawing-${id}`);
  await expect(
    page.getByRole("toolbar", { name: "จัดการภาพวาด" }),
  ).toBeVisible();
  await expect(page.getByTestId("drawing-preview")).toHaveCount(0);
  const drag = async (
    handle: ReturnType<typeof page.getByTestId>,
    dx: number,
    dy: number,
  ) => {
    const b = (await handle.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    const before = writes;
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, {
      steps: 8,
    });
    expect(writes).toBe(before);
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/visuals") && r.ok(),
    );
    await page.mouse.up();
    return (await (await response).json()) as Session;
  };
  const first = structuredClone(state.drawings[0]);
  state = await drag(page.getByTestId("drawing-handle-1"), 25, -35);
  expect(state.drawings[0].points[0]).toEqual(first.points[0]);
  expect(state.drawings[0].points[1].price).toBeGreaterThan(
    first.points[1].price,
  );
  const beforeMove = structuredClone(state.drawings[0]);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const currentBox = (await canvas.boundingBox())!;
  const visibleLine = shape.locator("line").first();
  const x =
    (Number(await visibleLine.getAttribute("x1")) +
      Number(await visibleLine.getAttribute("x2"))) /
    2;
  const y =
    (Number(await visibleLine.getAttribute("y1")) +
      Number(await visibleLine.getAttribute("y2"))) /
    2;
  await page.mouse.move(currentBox.x + x, currentBox.y + y);
  await page.mouse.down();
  await page.mouse.move(currentBox.x + x + 15, currentBox.y + y + 20, {
    steps: 6,
  });
  const moved = page.waitForResponse(
    (r) => r.url().endsWith("/visuals") && r.ok(),
  );
  await page.mouse.up();
  state = await (await moved).json();
  expect(state.drawings[0].points[0].price).toBeLessThan(
    beforeMove.points[0].price,
  );
  expect(
    state.drawings[0].points[1].price - state.drawings[0].points[0].price,
  ).toBeCloseTo(beforeMove.points[1].price - beforeMove.points[0].price);
  await page.getByLabel("ความหนาภาพวาด").selectOption("3");
  await expect(shape.locator("line").first()).toHaveAttribute(
    "stroke-width",
    "3",
  );
  await expect(page.getByLabel("ความหนาภาพวาด")).toBeEnabled();
  await page.getByLabel("รูปแบบเส้นภาพวาด").selectOption("dashed");
  await expect(shape.locator("line").first()).toHaveAttribute(
    "stroke-dasharray",
    "8 5",
  );
  await expect(page.getByLabel("รูปแบบเส้นภาพวาด")).toBeEnabled();
  await page.getByLabel("สีภาพวาด", { exact: true }).click();
  await page.getByRole("button", { name: "สี #ee7784", exact: true }).click();
  await expect(shape).toHaveAttribute("data-color", "#ee7784");
  await expect(
    page.getByRole("button", { name: "ล็อกภาพวาด", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "ล็อกภาพวาด", exact: true }).click();
  await expect(shape).toHaveAttribute("data-locked", "true");
  await expect(
    page.getByRole("button", { name: "ปลดล็อกภาพวาด", exact: true }),
  ).toBeEnabled();
  const count = writes;
  await page.mouse.move(currentBox.x + x, currentBox.y + y + 20);
  await page.mouse.down();
  await page.mouse.move(currentBox.x + x, currentBox.y + y + 40);
  await page.mouse.up();
  expect(writes).toBe(count);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../../docs/screenshots/drawing-editor-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: /Load โปรไฟล์/ }).click();
  await page
    .getByRole("button")
    .filter({ has: page.getByText(initial.name, { exact: true }) })
    .click();
  await expect(shape).toHaveAttribute("data-color", "#ee7784");
  await expect(shape).toHaveAttribute("data-locked", "true");
  await shape.focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("button", { name: "ปลดล็อกภาพวาด", exact: true })
    .click();
  await expect(shape).toHaveAttribute("data-locked", "false");
  await expect(
    page.getByRole("button", { name: "ล็อกภาพวาด", exact: true }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "../../docs/screenshots/drawing-editor-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "ลบภาพวาดที่เลือก", exact: true })
    .click();
  await expect(shape).toHaveCount(0);
  const final: Session = await (
    await request.get(`/api/v1/replay/sessions/${initial.id}`)
  ).json();
  expect(final.drawings).toEqual([]);
  expect(final.trades).toEqual([]);
  expect(final.cursor).toBe(initial.cursor);
  expect(errors).toEqual([]);
});

test("touch taps preview a line and a captured finger drag resizes it; Delete and Escape work", async ({
  browser,
  request,
}) => {
  const d = await data(request);
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL as string,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const initial = await create(page, d, "DEMO DATA · Touch drawings");
    await page
      .getByRole("button", { name: "Trendline Backtest", exact: true })
      .click();
    const canvas = page.getByTestId("replay-chart");
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width * 0.22, box.y + 150);
    await expect(page.getByTestId("drawing-preview")).toBeVisible();
    const saved = page.waitForResponse(
      (r) => r.url().endsWith("/visuals") && r.ok(),
    );
    await page.touchscreen.tap(box.x + box.width * 0.55, box.y + 205);
    const state: Session = await (await saved).json();
    const shape = page.getByTestId(`drawing-${state.drawings[0].id}`);
    await expect(
      page.getByRole("button", { name: "ล็อกภาพวาด", exact: true }),
    ).toBeEnabled();
    const handle = page.getByTestId("drawing-handle-1");
    const b = (await handle.boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const start = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    expect(
      await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.getAttribute("data-testid"),
        start,
      ),
    ).toBe("drawing-handle-1");
    const priorY = await shape.locator("line").first().getAttribute("y2");
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [start],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: start.x + 16, y: start.y - 35 }],
    });
    await expect(shape.locator("line").first()).not.toHaveAttribute(
      "y2",
      priorY!,
    );
    const edited = page.waitForResponse(
      (r) => r.url().endsWith("/visuals") && r.ok(),
    );
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    const changed: Session = await (await edited).json();
    expect(changed.drawings[0].points[0]).toEqual(state.drawings[0].points[0]);
    expect(changed.drawings[0].points[1].price).toBeGreaterThan(
      state.drawings[0].points[1].price,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: "../../docs/screenshots/drawing-editor-mobile.png",
      fullPage: true,
    });
    await shape.focus();
    await page.keyboard.press("Delete");
    await expect(shape).toHaveCount(0);
    await page
      .getByRole("button", { name: "Zone / OB Backtest", exact: true })
      .click();
    await canvas.scrollIntoViewIfNeeded();
    const next = (await canvas.boundingBox())!;
    await page.touchscreen.tap(next.x + 65, next.y + 140);
    await expect(page.getByTestId("drawing-preview")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("drawing-preview")).toHaveCount(0);
    expect(
      (
        await (
          await request.get(`/api/v1/replay/sessions/${initial.id}`)
        ).json()
      ).drawings,
    ).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("chart loader waits for actual profile data and reduced-motion disables decorative animation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/replay/datasets", async (route) => {
    const response = await route.fetch();
    await pending;
    await route.fulfill({ response });
  });
  await page.goto("/?page=replay");
  const loader = page.getByRole("status", {
    name: "กำลังเปิดโปรไฟล์ Backtest",
    exact: true,
  });
  await expect(loader).toBeVisible();
  expect(
    await loader
      .locator(".loader-trend")
      .evaluate((el) => parseFloat(getComputedStyle(el).animationDuration)),
  ).toBeLessThan(0.01);
  release();
  await expect(
    page.getByRole("button", { name: /Create โปรไฟล์/ }),
  ).toBeVisible();
  await expect(loader).toHaveCount(0);
  await expect(page.locator(".standalone-app")).toHaveCSS("opacity", "1");
  await expect(page.locator(".page-transition-indicator")).toHaveCount(0);
});

test("rectangles move into whitespace, resize on eight handles, undo/redo and coordinate modal keep market history unchanged", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const initial = await create(
    page,
    await data(request, true),
    "DEMO DATA · Free chart studio",
  );
  const canvas = page.getByTestId("replay-chart"),
    box = (await canvas.boundingBox())!;
  await page
    .getByRole("button", { name: "Zone / OB Backtest", exact: true })
    .click();
  await page.mouse.click(box.x + box.width * 0.74, box.y + 130);
  await page.mouse.move(box.x + box.width * 0.86, box.y + 240, { steps: 8 });
  await expect(page.getByTestId("drawing-preview")).toBeVisible();
  const waitVisual = () =>
    page.waitForResponse((r) => r.url().endsWith("/visuals") && r.ok());
  let response = waitVisual();
  await page.mouse.click(box.x + box.width * 0.86, box.y + 240);
  let state: Session = await (await response).json();
  const id = state.drawings[0].id,
    shape = page.getByTestId(`drawing-${id}`);
  expect(
    state.drawings[0].points.every((p) => p.time > initial.bars.at(-1)!.time),
  ).toBeTruthy();
  await expect(shape.locator('[data-testid^="drawing-handle-"]')).toHaveCount(
    8,
  );
  const start = structuredClone(state.drawings[0]);
  let writes = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/visuals") && r.method() === "PUT") writes++;
  });
  const east = (await page.getByTestId("drawing-handle-e").boundingBox())!;
  await page.mouse.move(east.x + east.width / 2, east.y + east.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    east.x + east.width / 2 - 30,
    east.y + east.height / 2,
    { steps: 10 },
  );
  expect(writes).toBe(0);
  response = waitVisual();
  await page.mouse.up();
  state = await (await response).json();
  expect(state.drawings[0].points[1].time).toBeLessThan(start.points[1].time);
  expect(state.drawings[0].points.map((p) => p.price)).toEqual(
    start.points.map((p) => p.price),
  );
  const resized = structuredClone(state.drawings[0]);
  const rect = (await shape.locator("rect").boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    rect.x + rect.width / 2 + 25,
    rect.y + rect.height / 2 + 25,
    { steps: 10 },
  );
  response = waitVisual();
  await page.mouse.up();
  state = await (await response).json();
  expect(state.drawings[0].points[0].time).toBeGreaterThan(
    resized.points[0].time,
  );
  expect(state.drawings[0].points[0].price).toBeLessThan(
    resized.points[0].price,
  );
  expect(
    state.drawings[0].points[1].time - state.drawings[0].points[0].time,
  ).toBeCloseTo(resized.points[1].time - resized.points[0].time, 0);
  const moved = structuredClone(state.drawings[0]);
  response = waitVisual();
  await page.getByLabel("Undo ภาพวาด").click();
  state = await (await response).json();
  expect(state.drawings[0]).toEqual(resized);
  response = waitVisual();
  await page.getByLabel("Redo ภาพวาด").click();
  state = await (await response).json();
  expect(state.drawings[0]).toEqual(moved);
  await shape.focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("รายละเอียดภาพวาด", { exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "รายละเอียดภาพวาด" }),
  ).toBeVisible();
  const editedTime = moved.points[0].time + 77;
  await page
    .getByLabel("เวลา จุด 1 (UTC)", { exact: true })
    .fill(new Date(editedTime * 1000).toISOString().slice(0, 19));
  await page.getByLabel("ราคา จุด 1", { exact: true }).fill("100.8");
  response = waitVisual();
  await page.getByRole("button", { name: "บันทึกภาพวาด", exact: true }).click();
  state = await (await response).json();
  expect(state.drawings[0].points[0].price).toBe(100.8);
  expect(state.drawings[0].points[0].time).toBe(editedTime);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  response = waitVisual();
  await page.getByLabel("ทำสำเนาภาพวาด", { exact: true }).click();
  state = await (await response).json();
  expect(state.drawings).toHaveLength(2);
  expect(state.drawings[1].id).not.toBe(id);
  await page.getByRole("button", { name: /ภาพวาด \(2\)/ }).click();
  await expect(
    page.getByRole("dialog", { name: "ภาพวาดบนกราฟ" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect(state.bars).toEqual(initial.bars);
  expect(state.trades).toEqual([]);
  expect(state.cursor).toBe(initial.cursor);
  const reloaded: Session = await (
    await request.get(`/api/v1/replay/sessions/${initial.id}`)
  ).json();
  expect(reloaded.drawings).toEqual(state.drawings);
  expect(errors).toEqual([]);
});

test("position body moves in two axes, horizontal handles resize and right-click opens price and volume settings", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const initial = await create(
    page,
    await data(request, true),
    "DEMO DATA · Trading chart workspace",
  );
  await page
    .getByRole("button", { name: "วาง Long Position", exact: true })
    .click();
  const overlay = page.getByTestId("position-overlay");
  const before = {
    time: Number(await overlay.getAttribute("data-time")),
    entry: Number(await overlay.getAttribute("data-entry")),
    tp: Number(await overlay.getAttribute("data-tp")),
    sl: Number(await overlay.getAttribute("data-sl")),
  };
  const body = (await page.getByTestId("position-body-profit").boundingBox())!;
  await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    body.x + body.width / 2 + 35,
    body.y + body.height / 2 - 15,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => Number(await overlay.getAttribute("data-time")))
    .toBeGreaterThan(before.time);
  const entry = Number(await overlay.getAttribute("data-entry"));
  expect(entry).toBeGreaterThan(before.entry);
  expect(Number(await overlay.getAttribute("data-tp")) - entry).toBeCloseTo(
    before.tp - before.entry,
  );
  expect(entry - Number(await overlay.getAttribute("data-sl"))).toBeCloseTo(
    before.entry - before.sl,
  );
  const end = Number(await overlay.getAttribute("data-end-time")),
    handle = (await page.getByTestId("position-handle-right").boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 - 25,
    handle.y + handle.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  expect(Number(await overlay.getAttribute("data-end-time"))).toBeLessThan(end);
  expect(Number(await overlay.getAttribute("data-entry"))).toBeCloseTo(entry);
  const toolbar = (await page
      .locator(".backtest-chart-toolbar")
      .boundingBox())!,
    transport = (await page
      .getByTestId("backtest-replay-controls")
      .boundingBox())!,
    chart = (await page.getByTestId("replay-chart").boundingBox())!;
  expect(toolbar.y).toBeLessThan(chart.y);
  expect(transport.y).toBeGreaterThan(chart.y + chart.height - 1);
  expect(chart.width).toBeGreaterThan(1000);
  await page.screenshot({
    path: "../../docs/screenshots/chart-studio-desktop.png",
    fullPage: true,
  });
  // After moving into whitespace the body may be clipped under the price axis.
  // Pan it back into the plot before right-clicking, as a user would.
  await page.mouse.move(chart.x + chart.width * 0.4, chart.y + 40);
  await page.mouse.down();
  await page.mouse.move(chart.x + chart.width * 0.4 - 150, chart.y + 40, {
    steps: 8,
  });
  await page.mouse.up();
  await page.getByTestId("position-body-profit").click({ button: "right" });
  await expect(
    page.getByRole("dialog", { name: "รายละเอียด Position" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "เปิด Position จำลอง", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Timeframe Backtest")).toBeEnabled();
  await page.getByRole("button", { name: "อินดิเคเตอร์", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "อินดิเคเตอร์บนกราฟ" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const saved: Session = await (
    await request.get(`/api/v1/replay/sessions/${initial.id}`)
  ).json();
  expect(saved.trades).toEqual([]);
  expect(saved.cursor).toBe(initial.cursor);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(overlay).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "../../docs/screenshots/chart-studio-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("Fibonacci settings apply levels/colors/geometry together, cancel safely, undo and resume on desktop/mobile", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const name = "DEMO DATA · Fibonacci settings";
  const initial = await create(page, await data(request, true), name);
  const box = (await page.getByTestId("replay-chart").boundingBox())!;
  await page
    .getByRole("button", { name: "Fib Retracement Backtest", exact: true })
    .click();
  await page.mouse.click(box.x + box.width * 0.55, box.y + 135);
  await page.mouse.move(box.x + box.width * 0.72, box.y + 215, { steps: 6 });
  await expect(
    page.getByTestId("drawing-preview").getByTestId("fibo-level"),
  ).toHaveCount(11);
  const waitVisual = () =>
    page.waitForResponse((r) => r.url().endsWith("/visuals") && r.ok());
  let response = waitVisual();
  await page.mouse.click(box.x + box.width * 0.72, box.y + 215);
  let state: Session = await (await response).json();
  const original = structuredClone(state.drawings[0]),
    id = original.id;
  const shape = page.getByTestId(`drawing-${id}`);
  await page.getByLabel("รายละเอียดภาพวาด", { exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Fib Retracement",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  let writes = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/visuals") && r.method() === "PUT") writes++;
  });
  await page.getByLabel("ค่าระดับ Fibo 1", { exact: true }).fill("-0.25");
  await page.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  expect(writes).toBe(0);
  expect(
    (await (await request.get(`/api/v1/replay/sessions/${state.id}`)).json())
      .drawings[0],
  ).toEqual(original);
  await page.getByLabel("รายละเอียดภาพวาด", { exact: true }).click();
  await page.getByLabel("ค่าระดับ Fibo 1", { exact: true }).fill("-0.25");
  await page.getByLabel("เปิดระดับ Fibo 2", { exact: true }).uncheck();
  await page.getByRole("button", { name: "เพิ่มระดับ", exact: true }).click();
  await expect(
    page.getByLabel("ค่าระดับ Fibo 25", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("ลบระดับ Fibo 25", { exact: true }).click();
  await page.getByLabel("สีระดับ Fibo 1", { exact: true }).click();
  const colors = page.getByRole("dialog", {
    name: "สีระดับ Fibo 1",
    exact: true,
  });
  await colors.getByLabel("สีที่กำหนดเอง", { exact: true }).fill("#abcdef");
  await colors.getByLabel("ความโปร่งใส (%)", { exact: true }).fill("60");
  await colors.getByRole("button", { name: "ใช้สี", exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.getByLabel("รูปแบบเส้นระดับ Fibo").selectOption("dotted");
  await page.getByLabel("ความหนาเส้นระดับ Fibo").selectOption("3");
  await page.getByLabel("การยืดเส้น Fibo").selectOption("both");
  await page.getByLabel("พื้นหลัง", { exact: true }).check();
  await page.getByLabel("กลับสถานะ", { exact: true }).check();
  await page.getByLabel("รูปแบบป้ายระดับ Fibo").selectOption("percent");
  await page.getByLabel("ตำแหน่งป้ายระดับ Fibo").selectOption("right");
  await page.getByLabel("ตัวอักษร", { exact: true }).uncheck();
  await page.getByRole("tab", { name: "พิกัดตำแหน่ง", exact: true }).click();
  await page.getByLabel("ราคา จุด 1", { exact: true }).fill("100.6");
  await page.getByLabel("ราคา จุด 2", { exact: true }).fill("99.4");
  await page
    .getByLabel("ชื่อ Fibo", { exact: true })
    .fill("DEMO · Custom Fibonacci");
  await page.getByRole("tab", { name: "การแสดงผล", exact: true }).click();
  for (const tf of ["M1", "M15", "M30", "H1", "H4", "D1"])
    await dialog.getByLabel(tf, { exact: true }).uncheck();
  await page.getByRole("tab", { name: "รูปแบบ", exact: true }).click();
  await dialog.screenshot({
    path: "../../docs/screenshots/fibo-settings-desktop.png",
  });
  response = waitVisual();
  await page.getByRole("button", { name: "ตกลง", exact: true }).click();
  state = await (await response).json();
  await expect(dialog).toHaveCount(0);
  expect(writes).toBe(1);
  expect(state.cursor).toBe(initial.cursor);
  expect(state.bars).toEqual(initial.bars);
  expect(state.trades).toEqual([]);
  expect(state.drawings[0].fibo?.timeframes).toEqual(["M5"]);
  const first = shape.locator('[data-testid="fibo-level"][data-level="-0.25"]');
  await expect(shape.getByTestId("fibo-level")).toHaveCount(10);
  expect(Number(await first.getAttribute("data-price"))).toBeCloseTo(99.1);
  await expect(first.getByTestId("fibo-level-line")).toHaveAttribute(
    "stroke",
    "#ABCDEF66",
  );
  await expect(first.getByTestId("fibo-level-line")).toHaveAttribute(
    "stroke-width",
    "3",
  );
  await expect(first.getByTestId("fibo-level-line")).toHaveAttribute(
    "stroke-dasharray",
    "2 5",
  );
  await expect(first.getByTestId("fibo-level-line")).toHaveAttribute("x1", "0");
  await expect(first.getByTestId("fibo-level-label")).toContainText(
    "-25% (99.1)",
  );
  await expect(first.getByTestId("fibo-level-label")).toHaveAttribute(
    "text-anchor",
    "end",
  );
  await expect(shape.getByTestId("fibo-band")).toHaveCount(9);
  await expect(shape.getByTestId("fibo-text")).toHaveCount(0);
  await page
    .getByTestId("replay-chart")
    .screenshot({ path: "../../docs/screenshots/fibo-chart-desktop.png" });
  const saved = structuredClone(state.drawings[0]);
  response = waitVisual();
  await page.getByLabel("Undo ภาพวาด").click();
  state = await (await response).json();
  expect(state.drawings[0]).toEqual(original);
  response = waitVisual();
  await page.getByLabel("Redo ภาพวาด").click();
  state = await (await response).json();
  expect(state.drawings[0]).toEqual(saved);
  const tfChange = page.waitForResponse(
    (r) => r.url().endsWith("/timeframe") && r.ok(),
  );
  await page.getByLabel("Timeframe Backtest").selectOption("M15");
  await tfChange;
  await expect(shape).toHaveCount(0);
  // A hidden drawing remains editable through the object list.
  await page.getByRole("button", { name: "ภาพวาด (1)", exact: true }).click();
  await page
    .getByRole("button", {
      name: "ตั้งค่า DEMO · Custom Fibonacci",
      exact: true,
    })
    .click();
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  const backTF = page.waitForResponse(
    (r) => r.url().endsWith("/timeframe") && r.ok(),
  );
  await page.getByLabel("Timeframe Backtest").selectOption("M5");
  await backTF;
  await expect(shape).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Load โปรไฟล์/ }).click();
  await page
    .getByRole("button")
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
  await expect(shape.getByTestId("fibo-level")).toHaveCount(10);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "ภาพวาด (1)", exact: true }).click();
  await page
    .getByRole("button", {
      name: "ตั้งค่า DEMO · Custom Fibonacci",
      exact: true,
    })
    .click();
  await expect(dialog).toBeVisible();
  const rect = (await dialog.boundingBox())!;
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(390);
  expect(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBeTruthy();
  await dialog.screenshot({
    path: "../../docs/screenshots/fibo-settings-mobile.png",
  });
  await page.getByLabel("ใช้สีเดียว", { exact: true }).check();
  await page.getByLabel("สีเดียว Fibo", { exact: true }).click();
  const singleColor = page.getByRole("dialog", {
    name: "สีเดียว Fibo",
    exact: true,
  });
  await singleColor
    .getByLabel("สีที่กำหนดเอง", { exact: true })
    .fill("#ffffff");
  await singleColor.getByRole("button", { name: "ใช้สี", exact: true }).click();
  await page.getByLabel("ราคา", { exact: true }).uncheck();
  await page.getByLabel("ระดับ", { exact: true }).uncheck();
  await page.getByLabel("เส้นแนวโน้ม", { exact: true }).uncheck();
  response = waitVisual();
  await page.getByRole("button", { name: "ตกลง", exact: true }).click();
  await response;
  await expect(shape.getByTestId("fibo-level-label")).toHaveCount(0);
  await expect(shape.getByTestId("fibo-trend")).toHaveCount(0);
  const strokes = await shape
    .getByTestId("fibo-level-line")
    .evaluateAll((lines) => lines.map((line) => line.getAttribute("stroke")));
  expect(strokes.every((color) => color === "#FFFFFFFF")).toBeTruthy();
  expect(errors).toEqual([]);
});

test("legacy Fibonacci remains 0/50/100 until its settings are explicitly saved", async ({
  page,
  request,
}) => {
  const initial = await create(
    page,
    await data(request),
    "DEMO DATA · Legacy Fibonacci",
  );
  const response = await request.put(
    `/api/v1/replay/sessions/${initial.id}/visuals`,
    {
      data: {
        revision: initial.revision,
        indicators: [],
        drawings: [
          {
            id: "legacy-fib",
            kind: "fibo",
            label: "Old Fibonacci",
            color: "#ee7784",
            points: [
              { time: initial.bars[10].time, price: 100.6 },
              { time: initial.bars[25].time, price: 99.4 },
            ],
          },
        ],
      },
    },
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: /Load โปรไฟล์/ }).click();
  await page
    .getByRole("button")
    .filter({
      has: page.getByText("DEMO DATA · Legacy Fibonacci", { exact: true }),
    })
    .click();
  const shape = page.getByTestId("drawing-legacy-fib");
  await expect(shape.getByTestId("fibo-level-label")).toHaveText([
    "0%",
    "50%",
    "100%",
  ]);
  await expect(shape.getByTestId("fibo-trend")).toHaveCount(0);
  await page.getByRole("button", { name: "ภาพวาด (1)", exact: true }).click();
  await page
    .getByRole("button", { name: "ตั้งค่า Old Fibonacci", exact: true })
    .click();
  await page.getByLabel("เทมเพลต Fibo").selectOption("reference");
  await expect(
    page.getByLabel("ค่าระดับ Fibo 24", { exact: true }),
  ).toHaveValue("4.764");
  await page.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  const resumed = await (
    await request.get(`/api/v1/replay/sessions/${initial.id}`)
  ).json();
  expect(resumed.drawings[0].fibo).toBeUndefined();
  await expect(shape.getByTestId("fibo-level-label")).toHaveText([
    "0%",
    "50%",
    "100%",
  ]);
});
