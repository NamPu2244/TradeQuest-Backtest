import { readFileSync } from "node:fs";
import ts from "typescript";
import type { PineReply } from "../components/replay/pine-runtime";
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import type { Session } from "../components/replay/types";
async function open(page: Page, request: APIRequestContext) {
  const d = await (await request.post("/api/v1/replay/datasets/demo")).json();
  const name = "DEMO Pine " + Date.now();
  const s = (await (
    await request.post("/api/v1/replay/sessions", {
      data: {
        dataset_id: d.id,
        name,
        workspace: "backtest",
        initial_balance: 1000,
        target_trades: 20,
        goal: "Pine indicator tests",
        point_value: 1,
      },
    })
  ).json()) as Session;
  await page.goto("/?page=replay");
  await page.getByRole("button", { name: /Load โปรไฟล์/ }).click();
  await page
    .getByRole("button")
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
  await expect(page.getByTestId("backtest-workspace")).toBeVisible();
  await page.getByRole("button", { name: "Pine Editor", exact: true }).click();
  return s;
}
const CODE =
  '//@version=6\nindicator("Custom close", overlay=true)\nlength=input.int(3,"Period",minval=1,maxval=500)\nplot(ta.sma(close,length),"SMA",color=color.orange,linewidth=2)';
test("own v6 indicator: native inputs, save, plot, immutable versions, resume and import/export", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const s = await open(page, request);
  await page.getByLabel("ชื่อ Pine Indicator").fill("Own SMA");
  await page.getByLabel("โค้ด Pine v5 / v6").fill(CODE);
  await page.getByRole("button", { name: "ตรวจและรัน", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("รันผ่าน");
  await page.getByRole("button", { name: "Inputs", exact: true }).click();
  await page.getByLabel("Pine input Period").fill("2");
  await page.getByRole("button", { name: "ตกลง", exact: true }).click();
  await page.getByRole("button", { name: "นำขึ้นกราฟ", exact: true }).click();
  await expect(page.getByTestId("pine-chart-result")).toContainText(
    "Custom close",
  );
  await expect
    .poll(async () =>
      Number(
        await page
          .getByTestId("pine-chart-result")
          .getAttribute("data-last-value"),
      ),
    )
    .toBeCloseTo((s.bars.at(-1)!.close + s.bars.at(-2)!.close) / 2, 8);
  const saved = await (
    await request.get("/api/v1/replay/sessions/" + s.id)
  ).json();
  expect(saved.indicators[0].inputs).toEqual({ in_0: 2 });
  expect(saved.indicators[0].script_version).toBe(1);
  await page
    .getByLabel("โค้ด Pine v5 / v6")
    .fill(CODE.replace("ta.sma(close,length)", "ta.sma(close,length) + 10"));
  await page
    .getByRole("button", { name: "บันทึกเวอร์ชัน", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("v2");
  expect(
    (await (await request.get("/api/v1/replay/sessions/" + s.id)).json())
      .indicators[0].source,
  ).toBe(CODE);
  await page.getByRole("button", { name: "อัปเดตบนกราฟ", exact: true }).click();
  await expect
    .poll(async () =>
      Number(
        await page
          .getByTestId("pine-chart-result")
          .getAttribute("data-last-value"),
      ),
    )
    .toBeCloseTo(10 + (s.bars.at(-1)!.close + s.bars.at(-2)!.close) / 2, 8);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก Pine" }).click();
  expect((await download).suggestedFilename()).toBe("Own SMA.pine");
  await page.getByRole("button", { name: "ปิด Pine Editor" }).click();
  const canvas = await page
    .locator('[data-testid="replay-chart"] canvas')
    .first()
    .elementHandle();
  await page.getByRole("button", { name: "ทีละแท่ง", exact: true }).click();
  await expect(page.getByTestId("pine-chart-result")).toHaveAttribute(
    "data-last-time",
    String(s.bars.at(-1)!.time + 300),
  );
  expect(await canvas!.evaluate((n) => n.isConnected)).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: /Load โปรไฟล์/ }).click();
  await page
    .getByRole("button")
    .filter({ has: page.getByText(s.name, { exact: true }) })
    .click();
  await expect(page.getByTestId("pine-chart-result")).toContainText(
    "Custom close",
  );
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Pine Editor", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "Imported.pine",
    mimeType: "text/plain",
    buffer: Buffer.from(CODE),
  });
  await expect(page.getByLabel("ชื่อ Pine Indicator")).toHaveValue("Imported");
  await expect(page.getByLabel("โค้ด Pine v5 / v6")).toHaveValue(CODE);
  await page.screenshot({
    path: "../../docs/screenshots/pine-editor-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(
    await page.evaluate(() => document.body.scrollWidth <= innerWidth + 1),
  ).toBeTruthy();
  await page.getByTestId("pine-editor").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "../../docs/screenshots/pine-editor-mobile.png",
    fullPage: false,
  });
});
test("unsupported and broken scripts fail visibly; MACD runs in a pane and is removable", async ({
  page,
  request,
}) => {
  await open(page, request);
  for (const code of [
    CODE.replace(
      "ta.sma(close,length)",
      'request.security(syminfo.tickerid,"60",close)',
    ),
    CODE + "\nnot_valid ! @",
  ]) {
    await page.getByLabel("โค้ด Pine v5 / v6").fill(code);
    await page.getByRole("button", { name: "นำขึ้นกราฟ", exact: true }).click();
    await expect(
      page.getByTestId("pine-editor").getByRole("alert"),
    ).toBeVisible();
    await expect(page.getByTestId("pine-chart-result")).toHaveCount(0);
  }
  await page
    .getByRole("button", { name: "ตัวอย่าง MACD", exact: true })
    .click();
  await page.getByRole("button", { name: "นำขึ้นกราฟ", exact: true }).click();
  await expect(page.getByTestId("pine-chart-result")).toContainText("My MACD");
  await expect(
    page.locator('[data-testid="replay-chart"] table tr'),
  ).toHaveCount(4);
  await page.getByRole("button", { name: "ปิด Pine Editor" }).click();
  await page.getByRole("button", { name: "อินดิเคเตอร์", exact: true }).click();
  await page
    .getByRole("button", { name: "ลบ My MACD · v1", exact: true })
    .click();
  await expect(page.getByTestId("pine-chart-result")).toHaveCount(0);
});

declare global {
  interface Window {
    TQPineSandbox: typeof import("../components/replay/pine-runtime").PineSandbox;
  }
}
test("opaque worker: Replay clock, rollback, no network, limits and recovery", async ({
  page,
}) => {
  await page.goto("/?page=replay");
  const js = ts
    .transpileModule(
      readFileSync("components/replay/pine-runtime.ts", "utf8"),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      },
    )
    .outputText.replace(/export /g, "");
  await page.addScriptTag({
    content: js + "\nwindow.TQPineSandbox=PineSandbox;",
  });
  const bars = Array.from({ length: 40 }, (_, i) => ({
    time: 1735689600 + i * 300,
    open: 100 + i,
    high: 102 + i,
    low: 99 + i,
    close: 101 + i,
    volume: 10,
  }));
  const source =
    '//@version=6\nindicator("Clock",overlay=false)\nvar count=0\ncount+=1\nplot(barstate.isconfirmed?1:0,"Confirmed")\nplot(count,"Count")\nplot(close,"Price")';
  const replies = await page.evaluate(
    async ({ bars, source, drawSource }) => {
      const box = new window.TQPineSandbox();
      const a = await box.run({
        bars,
        items: [{ id: "clock", source, inputs: {} }],
        symbol: "TEST",
        timeframe: "M5",
        clock: bars.at(-1)!.time * 1000 + 1000,
      });
      const b = await box.run({
        bars: bars.slice(0, 31),
        items: [{ id: "clock", source, inputs: {} }],
        symbol: "TEST",
        timeframe: "M5",
        clock: (bars[30].time + 300) * 1000,
      });
      const c = await box.run({
        bars,
        items: [{ id: "draw", source: drawSource, inputs: {} }],
        symbol: "TEST",
        timeframe: "M5",
        clock: (bars.at(-1)!.time + 300) * 1000,
      });
      box.dispose();
      return [a, b, c];
    },
    { bars, source, drawSource: DRAWING_CODE },
  );
  expect(
    replies[2][0].result!.drawings.find((d) => d.kind === "box")!.border_color,
  ).toBe("#00000000");
  expect(
    replies[2][0].result!.drawings.filter((d) => d.kind === "line"),
  ).toHaveLength(1);
  expect(replies[2][0].result!.backgrounds).toHaveLength(20);
  expect(
    replies[2][0].result!.drawings.find((d) => d.kind === "label")!.textcolor,
  ).toMatch(/^#[a-f0-9]{3,8}$/i);
  expect(
    replies[2][0].result!.drawings.find((d) => d.kind === "label")!.textcolor,
  ).not.toBe("#00000000");
  const [live, closed] = replies.map((r: PineReply[]) => r[0].result!);
  expect(
    live.plots.find((p) => p.title === "Confirmed")!.data.at(-1)!.value,
  ).toBe(0);
  expect(
    closed.plots.find((p) => p.title === "Confirmed")!.data.at(-1)!.value,
  ).toBe(1);
  expect(live.plots.find((p) => p.title === "Count")!.data.at(-1)!.value).toBe(
    40,
  );
  expect(
    closed.plots.find((p) => p.title === "Count")!.data.at(-1)!.value,
  ).toBe(31);
  expect(
    closed.plots.find((p) => p.title === "Price")!.data.at(-1)!.value,
  ).toBe(131);
  const security = await page.evaluate(
    async ({ bars }) => {
      const box = new window.TQPineSandbox();
      await box.run({
        bars,
        items: [
          {
            id: "test",
            source: '//@version=6\nindicator("Test")\nplot(close)',
            inputs: {},
          },
        ],
        symbol: "TEST",
        timeframe: "M5",
        clock: bars.at(-1)!.time * 1000,
      });
      return document
        .querySelector('iframe[sandbox="allow-scripts"]')
        ?.getAttribute("sandbox");
    },
    { bars },
  );
  expect(security).toBe("allow-scripts");
  const frame = (await (await page
    .locator('iframe[sandbox="allow-scripts"]')
    .first()
    .elementHandle())!.contentFrame())!;
  const blocked = await frame.evaluate(async () => {
    let dom = false,
      storage = false,
      network = false;
    try {
      void parent.document.body;
    } catch {
      dom = true;
    }
    try {
      void localStorage.length;
    } catch {
      storage = true;
    }
    try {
      await fetch("http://127.0.0.1:8789/health");
    } catch {
      network = true;
    }
    const workerNetwork = await new Promise<boolean>((resolve) => {
      const w = new Worker(
        URL.createObjectURL(
          new Blob(
            [
              'fetch("http://127.0.0.1:8789/health").then(()=>postMessage(false)).catch(()=>postMessage(true))',
            ],
            { type: "text/javascript" },
          ),
        ),
      );
      w.onmessage = (e) => {
        resolve(e.data);
        w.terminate();
      };
    });
    return { dom, storage, network, workerNetwork };
  });
  expect(blocked).toEqual({
    dom: true,
    storage: true,
    network: true,
    workerNetwork: true,
  });
  const loop = await page.evaluate(
    async ({ bars }) => {
      const box = new window.TQPineSandbox();
      const r = await box.run({
        bars,
        items: [
          {
            id: "loop",
            source:
              '//@version=6\nindicator("Loop")\nx=0\nwhile true\n    x+=1\nplot(x)',
            inputs: {},
          },
        ],
        symbol: "TEST",
        timeframe: "M5",
        clock: bars.at(-1)!.time * 1000,
      });
      box.dispose();
      return r;
    },
    { bars },
  );
  expect(loop[0].error).toBeTruthy();
});

test("Pine tick playback keeps canvases, follows TF and erases future values on rewind", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const name = "DEMO Pine ticks " + Date.now();
  await (
    await request.post("/api/v1/replay/sessions", {
      data: {
        dataset_id: "demo-tick-e2e",
        workspace: "backtest",
        name,
        initial_balance: 1000,
        target_trades: 20,
        point_value: 100,
        goal: "Pine ticks",
        start_time: 1735782000,
      },
    })
  ).json();
  await page.goto("/?page=replay");
  await page.getByRole("button", { name: /Load โปรไฟล์/ }).click();
  await page
    .getByRole("button")
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
  await page.getByRole("button", { name: "Pine Editor", exact: true }).click();
  await page
    .getByLabel("โค้ด Pine v5 / v6")
    .fill(
      '//@version=6\nindicator("Current tick",overlay=true)\nplot(close,"Price")',
    );
  await page.getByRole("button", { name: "นำขึ้นกราฟ", exact: true }).click();
  await expect(page.getByTestId("pine-chart-result")).toHaveAttribute(
    "data-last-value",
    "100",
  );
  await page.getByRole("button", { name: "ปิด Pine Editor" }).click();
  const canvas = await page
    .locator('[data-testid="replay-chart"] canvas')
    .first()
    .elementHandle();
  await page.getByRole("button", { name: "ทีละ Tick", exact: true }).click();
  await expect(page.getByTestId("pine-chart-result")).toHaveAttribute(
    "data-last-value",
    "101",
  );
  await page.getByRole("button", { name: "ทีละ Tick", exact: true }).click();
  await expect(page.getByTestId("pine-chart-result")).toHaveAttribute(
    "data-last-value",
    "110",
  );
  for (const tf of ["M1", "H1", "M5"]) {
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/timeframe") && r.request().method() === "PUT",
    );
    await page.getByLabel("Timeframe Backtest").selectOption(tf);
    const frame = (await (await response).json()) as Session;
    await expect(page.getByTestId("pine-chart-result")).toHaveAttribute(
      "data-last-time",
      String(frame.bars.at(-1)!.time),
    );
  }
  const rewound = page.waitForResponse(
    (r) => r.url().endsWith("/rewind") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "ย้อนแท่ง", exact: true }).click();
  const resumed = (await (await rewound).json()) as Session;
  await expect(page.getByTestId("pine-chart-result")).toHaveAttribute(
    "data-last-value",
    String(resumed.bars.at(-1)!.close),
  );
  await page.getByLabel("ความเร็ว Backtest").selectOption("60");
  await page.getByRole("button", { name: "เล่น Replay", exact: true }).click();
  await expect
    .poll(async () =>
      Number(
        await page
          .getByTestId("pine-chart-result")
          .getAttribute("data-last-value"),
      ),
    )
    .not.toBe(resumed.bars.at(-1)!.close);
  await page.getByRole("button", { name: "หยุด Replay", exact: true }).click();
  expect(await canvas!.evaluate((n) => n.isConnected)).toBeTruthy();
  expect(errors).toEqual([]);
});
test("hard deadline terminates a stuck worker while the app stays responsive", async ({
  page,
}) => {
  await page.route("**/api/pine-runtime", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "onmessage=()=>{while(true){}}",
    }),
  );
  await page.goto("/?page=replay");
  const js = ts
    .transpileModule(
      readFileSync("components/replay/pine-runtime.ts", "utf8"),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      },
    )
    .outputText.replace(/export /g, "");
  await page.addScriptTag({
    content: js + "\nwindow.TQPineSandbox=PineSandbox;",
  });
  const error = await page.evaluate(async () => {
    const box = new window.TQPineSandbox();
    try {
      await box.run({
        bars: [
          {
            time: 1735689600,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 10,
          },
        ],
        items: [],
        symbol: "TEST",
        timeframe: "M5",
        clock: 1735689600000,
      });
      return "unexpected";
    } catch (e) {
      return (e as Error).message;
    }
  });
  expect(error).toContain("5 วินาที");
  await expect.poll(() => page.workers().length).toBe(0);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  await page.getByRole("button", { name: /Create โปรไฟล์/ }).click();
  await expect(page.getByLabel("ชื่อโปรไฟล์ Backtest")).toBeVisible();
});

const DRAWING_CODE = `// Authored test fixture; attribution comments precede the version.
// No external script is bundled.
//@version=5
indicator("Drawing fixture", overlay=true)
type Marker
    line edge
method move(Marker m, int x, float p) =>
    m.edge.set_xy2(x, p)
var Marker m = Marker.new(line.new(bar_index, close, bar_index + 1, close, color=color.red))
var box zone = box.new(bar_index, high, bar_index + 1, low, bgcolor=color.new(color.green,70), border_color=na, text="Zone")
var label note = label.new(bar_index, high, "NOTE", color=color.blue)
if barstate.islast
    m.move(bar_index, close)
    box.set_lefttop(zone, bar_index - 5, close + 2)
    box.set_rightbottom(zone, bar_index + 5, close - 2)
    label.set_xy(note, bar_index, close)
    dead = line.new(time, close, time + 300000, close, xloc=xloc.bar_time)
    line.delete(dead)
bgcolor(bar_index % 2 == 0 ? color.new(color.blue,80) : na)
`;
test("commented v5 drawing-only indicator: methods, boxes, lines, labels, background, scroll and Replay", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const s = await open(page, request);
  const code = page.getByLabel("โค้ด Pine v5 / v6");
  await code.fill(DRAWING_CODE);
  await code.evaluate((el: HTMLTextAreaElement) => {
    el.scrollTop = 200;
    el.dispatchEvent(new Event("scroll"));
  });
  expect(
    await code.evaluate(
      (el: HTMLTextAreaElement) =>
        el.previousElementSibling!.scrollTop === el.scrollTop,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "นำขึ้นกราฟ", exact: true }).click();
  const result = page.getByTestId("pine-chart-result");
  await expect(result).toContainText("Drawing fixture");
  await expect(result).toHaveAttribute("data-drawing-count", "3");
  await expect(result).toHaveAttribute(
    "data-background-count",
    String(Math.ceil(s.bars.length / 2)),
  );
  const saved = await (
    await request.get("/api/v1/replay/sessions/" + s.id)
  ).json();
  expect(saved.indicators[0].source).toBe(DRAWING_CODE);
  await page.getByRole("button", { name: "ปิด Pine Editor" }).click();
  const canvas = await page
    .locator('[data-testid="replay-chart"] canvas')
    .first()
    .elementHandle();
  await page.getByRole("button", { name: "ทีละแท่ง", exact: true }).click();
  await expect(result).toHaveAttribute("data-drawing-count", "3");
  await expect(result).toHaveAttribute(
    "data-background-count",
    String(Math.ceil((s.bars.length + 1) / 2)),
  );
  await expect
    .poll(async () =>
      page
        .locator('[data-testid="replay-chart"] canvas')
        .first()
        .evaluate((el: HTMLCanvasElement) => {
          const pixels = el
            .getContext("2d")!
            .getImageData(0, 20, el.width, 1).data;
          for (let i = 0; i < pixels.length; i += 4)
            if (pixels[i + 2] > pixels[i] + 30) return true;
          return false;
        }),
    )
    .toBeTruthy();
  const bounds = await page.getByTestId("replay-chart").boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width * 0.65, bounds!.y + 180);
  await page.mouse.wheel(0, -100);
  await page.mouse.down();
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.65 + 70,
    bounds!.y + 185,
    { steps: 5 },
  );
  await page.mouse.up();
  expect(await canvas!.evaluate((el) => el.isConnected)).toBeTruthy();
  await page.screenshot({
    path: "../../docs/screenshots/pine-drawings.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "อินดิเคเตอร์", exact: true }).click();
  await page
    .getByRole("button", { name: "ลบ My EMA · v1", exact: true })
    .click();
  await expect(result).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("oversize paste is not silently truncated and version errors are separate", async ({
  page,
  request,
}) => {
  await open(page, request);
  const code = page.getByLabel("โค้ด Pine v5 / v6");
  const huge = CODE + "\n//" + "x".repeat(40000);
  await code.fill(huge);
  await expect(code).toHaveValue(huge);
  await page.getByRole("button", { name: "ตรวจและรัน", exact: true }).click();
  await expect(
    page.getByTestId("pine-editor").getByRole("alert"),
  ).toContainText("โค้ดยาวเกิน 40,000");
  await code.fill(CODE.replace("//@version=6", "//@version=4"));
  await page.getByRole("button", { name: "ตรวจและรัน", exact: true }).click();
  await expect(
    page.getByTestId("pine-editor").getByRole("alert"),
  ).toContainText("//@version=5 หรือ //@version=6");
});

const SETTINGS_CODE = `//@version=6
indicator("Settings fixture", overlay=true)
asSH = input.bool(true, "", inline="asia", group="Killzones", display=display.none)
asST = input.string("Asian", "", inline="asia", group="Killzones")
asS = input.session("2000-0000", "", inline="asia", group="Killzones")
asC = input.color(color.new(#e91e63,90), "", inline="asia", group="Killzones", tooltip="Session color")
mean = input.bool(false,"Mean",inline="lines",group="Killzones")
extend = input.bool(true,"Extend",inline="lines",group="Killzones")
cap = input.int(15,"TF cap",options=[5,15,30],group="Killzones")
week = input.session("2000-0000:23456","Weekdays",group="More")
multi = input.session("0900-1200,1300-1700:12345","Split session",group="More")
gray = input(color.new(color.gray,89),"Generic color",group="More")
notes = input.string("","Notes",group="More")
plot(asSH ? close : na, color=asC)
`;
test("Pine settings follow group/inline metadata with session, alpha, cancel, reset and saved values", async ({
  page,
  request,
}) => {
  const s = await open(page, request);
  await page.getByLabel("โค้ด Pine v5 / v6").fill(SETTINGS_CODE);
  await page.getByRole("button", { name: "ตรวจและรัน", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("รันผ่าน");
  const inputs = page.getByRole("button", { name: "Inputs", exact: true });
  await inputs.click();
  const main = page.getByRole("dialog", {
    name: "Settings fixture",
    exact: true,
  });
  await expect(
    main.getByRole("heading", { name: "Killzones", exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole("heading", { name: "More", exact: true }),
  ).toBeVisible();
  const asian = main.getByLabel("Pine input Asian", { exact: true });
  const start = main.getByLabel("Pine input ช่วงเวลา Asian เริ่ม");
  const end = main.getByLabel("Pine input ช่วงเวลา Asian สิ้นสุด");
  const color = main.getByRole("button", {
    name: "Pine input สี Asian",
    exact: true,
  });
  await expect(main.getByLabel("Pine input เปิด/ปิด Asian")).toBeChecked();
  await expect(start).toHaveValue("20:00");
  const row = main
    .getByTestId("pine-input-row")
    .filter({ has: page.getByLabel("Pine input Asian", { exact: true }) });
  await expect(row).toHaveAttribute("data-inline", "true");
  await expect(row.locator(".pine-field")).toHaveCount(4);
  expect(await main.innerText()).not.toMatch(/asSH|asST|asS|asC/);
  const a = await asian.boundingBox(),
    b = await start.boundingBox();
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(3);
  await asian.fill("Cancelled");
  await start.fill("19:00");
  await main.getByLabel("Pine input เปิด/ปิด Asian").uncheck();
  await main.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  await inputs.click();
  await expect(asian).toHaveValue("Asian");
  await expect(start).toHaveValue("20:00");
  await expect(main.getByLabel("Pine input เปิด/ปิด Asian")).toBeChecked();
  const before = await color.locator("span").getAttribute("style");
  await color.click();
  const picker = page.getByRole("dialog", { name: "สี Asian", exact: true });
  await picker
    .getByRole("button", { name: "เลือกสี #00bcd4", exact: true })
    .click();
  await picker.getByRole("button", { name: "ยกเลิกสี" }).click();
  expect(await color.locator("span").getAttribute("style")).toBe(before);
  await color.click();
  await picker
    .getByRole("button", { name: "เลือกสี #00bcd4", exact: true })
    .click();
  await expect(
    picker.getByLabel("ความโปร่งใส (%)", { exact: true }),
  ).toHaveValue("90");
  await picker.getByLabel("ความโปร่งใส (%)", { exact: true }).fill("40");
  await picker.getByRole("button", { name: "ใช้สี", exact: true }).click();
  await expect(main).toBeVisible();
  await asian.fill("Asian custom");
  await start.fill("19:00");
  await end.fill("23:00");
  await main.getByLabel("Pine input Weekdays เริ่ม").fill("19:00");
  await main.getByLabel("Pine input TF cap").selectOption("30");
  await expect(main.getByLabel("Pine input Split session")).toHaveValue(
    "0900-1200,1300-1700:12345",
  );
  await expect(
    main.getByRole("button", { name: "Pine input Generic color", exact: true }),
  ).toBeVisible();
  await expect(main.getByLabel("Pine input Notes")).toHaveValue("");
  await page.screenshot({
    path: "../../docs/screenshots/pine-settings-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    main.getByRole("button", { name: "ตกลง", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.body.scrollWidth <= innerWidth + 1),
    )
    .toBeTruthy();
  expect(
    await main
      .locator(".pine-input-groups")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBeTruthy();
  await page.screenshot({
    path: "../../docs/screenshots/pine-settings-mobile.png",
    fullPage: false,
  });
  await main.getByRole("button", { name: "ตกลง", exact: true }).click();
  await inputs.click();
  await main.getByRole("button", { name: "คืนค่าเริ่มต้น" }).click();
  await expect(start).toHaveValue("20:00");
  await expect(asian).toHaveValue("Asian");
  await main.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  await inputs.click();
  await expect(start).toHaveValue("19:00");
  await main.getByRole("button", { name: "ตกลง", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "นำขึ้นกราฟ", exact: true }).click();
  await expect(page.getByTestId("pine-chart-result")).toContainText(
    "Settings fixture",
  );
  const saved = await (
    await request.get("/api/v1/replay/sessions/" + s.id)
  ).json();
  expect(saved.indicators[0].inputs).toEqual({
    in_1: "Asian custom",
    in_2: "1900-2300",
    in_3: "#00BCD499",
    in_6: 30,
    in_7: "1900-0000:23456",
  });
  expect(saved.indicators[0].source).toBe(SETTINGS_CODE);
  await inputs.click();
  await main.getByRole("button", { name: "คืนค่าเริ่มต้น" }).click();
  await main.getByRole("button", { name: "ตกลง", exact: true }).click();
  await page.getByRole("button", { name: "อัปเดตบนกราฟ", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/v1/replay/sessions/" + s.id)).json())
          .indicators[0].inputs,
    )
    .toEqual({});
});
