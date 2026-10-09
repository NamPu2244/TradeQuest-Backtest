/* TradeQuest sandbox adapter for PineTS 0.11.0. No application API or market provider. */
/* global PineTSLib */
const scripts = new Map();
const realNow = Date.now;
function validate(source) {
  if (source.length > 40000) throw Error("โค้ดยาวเกิน 40,000 ตัวอักษร");
  if (
    !/^(?:\s*\/\/[^\n]*\n)*\s*\/\/@version=[56][ \t]*\r?(\n|$)/.test(
      source.replace(/^\uFEFF/, ""),
    )
  )
    throw Error(
      "ระบุ //@version=5 หรือ //@version=6 ก่อนโค้ด (มีคอมเมนต์ลิขสิทธิ์ก่อนหน้าได้)",
    );
  // Ignore comments/literals: labels may legitimately contain names of unsupported APIs.
  const code = source.replace(
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*/g,
    " ",
  );
  if (!/\bindicator\s*\(/.test(code))
    throw Error("รุ่นนี้ใช้ indicator() เท่านั้น");
  const unsupported =
    /\b(request|strategy|library|table|polyline|linefill|plotshape|plotchar|plotarrow|plotcandle|plotbar|fill|barcolor|alert|alertcondition)\b\s*[.(]/.exec(
      code,
    );
  if (/^\s*(import|export)\b/m.test(code))
    throw Error("import/export ยังไม่รองรับ");
  if (unsupported)
    throw Error(
      unsupported[1] +
        " ยังไม่รองรับใน Replay รุ่นนี้ ดูรายการที่รองรับใต้ Editor",
    );
  if (
    /\b(eval|Function|globalThis|self|window|document|fetch|XMLHttpRequest|WebSocket|importScripts|constructor|__proto__|prototype)\b|\/\*/.test(
      code,
    )
  )
    throw Error(
      "รับเฉพาะโค้ด Pine indicator ไม่รับ JavaScript หรือการเรียกภายนอก",
    );
}
function validateInputs(script, inputs) {
  const meta = script.getInputsMeta();
  if (meta.length > 100) throw Error("Inputs เกิน 100 ค่า");
  for (const [key, value] of Object.entries(inputs || {})) {
    const m = meta.find((m) => [m.id, m.name, m.varId].includes(key));
    if (!m) throw Error("ไม่พบ input " + key);
    if (["int", "float", "price", "time"].includes(m.type)) {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        (m.type === "int" && !Number.isInteger(value)) ||
        (m.minval !== undefined && value < m.minval) ||
        (m.maxval !== undefined && value > m.maxval)
      )
        throw Error("Input " + m.name + " อยู่นอกช่วงที่กำหนด");
    } else if (m.type === "bool") {
      if (typeof value !== "boolean")
        throw Error("Input " + m.name + " ต้องเป็น true/false");
    } else if (typeof value !== "string")
      throw Error("Input " + m.name + " ต้องเป็นข้อความ");
    if (m.options && !m.options.includes(value))
      throw Error("Input " + m.name + " ไม่ตรงตัวเลือก");
  }
}
function color(value, fallback = "#79aef8") {
  return typeof value === "string" &&
    /^(#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|rgba?\([\d., %]+\))$/i.test(
      value,
    )
    ? value
    : fallback;
}
// Copy only render data; never transfer live engine objects/helpers to the app.
function drawings(ctx, bars) {
  const out = [];
  const schemas = {
    __lines__: [
      "line",
      ["x1", "y1", "x2", "y2"],
      ["color", "style", "extend"],
      ["width"],
    ],
    __boxes__: [
      "box",
      ["left", "top", "right", "bottom"],
      [
        "border_color",
        "border_style",
        "extend",
        "bgcolor",
        "text",
        "text_color",
        "text_size",
        "text_halign",
        "text_valign",
      ],
      ["border_width"],
    ],
    __labels__: [
      "label",
      ["x", "y"],
      ["yloc", "color", "style", "text", "textcolor", "size", "textalign"],
      [],
    ],
  };
  for (const [key, [kind, coords, strings, numbers]] of Object.entries(
    schemas,
  )) {
    for (const o of ctx.plots[key]?.data.at(-1)?.value || []) {
      if (o._deleted || !coords.every((k) => Number.isFinite(o[k]))) continue;
      if (!["bi", "bt"].includes(o.xloc))
        throw Error("drawing xloc ยังไม่รองรับ");
      if (!ctx.indicator.overlay && !o.force_overlay)
        throw Error("กล่อง/เส้น/ป้ายใน pane แยกยังไม่รองรับ");
      const d = { kind, xloc: o.xloc };
      for (const k of coords) d[k] = o[k];
      for (const k of strings)
        d[k] = k.includes("color")
          ? o[k] === "" && kind === "label"
            ? k === "textcolor"
              ? "#ffffff"
              : "#2962ff"
            : color(o[k], "#00000000")
          : String(o[k] || "").slice(0, 500);
      for (const k of numbers)
        d[k] = Math.min(4, Math.max(0, Number(o[k]) || 0));
      out.push(d);
    }
  }
  if (out.length > 1500) throw Error("วัตถุบนกราฟเกิน 1,500 ชิ้น");
  const backgrounds = [];
  const times = new Set(bars.map((b) => b.time));
  for (const p of Object.values(ctx.plots)) {
    if (p.options.style !== "background") continue;
    if (!p.options.overlay) throw Error("bgcolor ใน pane แยกยังไม่รองรับ");
    for (const d of p.data) {
      if (times.has(d.time / 1000) && d.value && d.options?.color != null)
        backgrounds.push({
          time: d.time / 1000,
          color: color(d.options.color),
        });
    }
  }
  if (backgrounds.length > 32000)
    throw Error("bgcolor เกินขอบเขต 32,000 แถบสี");
  return { drawings: out, backgrounds };
}
function result(ctx, script, bars, source) {
  if (ctx.indicator.timeframe)
    throw Error("indicator(timeframe=...) ยังไม่รองรับ ใช้ TF ของ Replay");
  if (ctx.warnings?.length)
    throw Error(
      ctx.warnings
        .map((w) => w.message)
        .slice(0, 3)
        .join(" · "),
    );
  const times = new Set(bars.map((b) => b.time));
  const plots = Object.entries(ctx.plots).filter(
    ([key]) =>
      ![
        "__labels__",
        "__lines__",
        "__boxes__",
        "__linefills__",
        "__polylines__",
        "__tables__",
      ].includes(key) && ctx.plots[key].options.style !== "background",
  );
  if (plots.length > 16) throw Error("สคริปต์มี plot/hline ได้สูงสุด 16 ชุด");
  return {
    ...drawings(ctx, bars),
    pineVersion: Number(source.match(/^\s*\/\/@version=([56])[ \t]*\r?$/m)[1]),
    title: String(ctx.indicator.title || "Pine").slice(0, 100),
    settingsTitle: String(
      ctx.indicator.shorttitle || ctx.indicator.title || "Pine",
    ).slice(0, 100),
    overlay: !!ctx.indicator.overlay,
    inputs: script.getInputsMeta().map((m) => ({
      id: m.id,
      name: m.name || m.varId || m.id,
      title: typeof m.title === "string" ? m.title : undefined,
      group: typeof m.group === "string" ? m.group.slice(0, 100) : undefined,
      inline: typeof m.inline === "string" ? m.inline.slice(0, 100) : undefined,
      tooltip:
        typeof m.tooltip === "string" ? m.tooltip.slice(0, 2000) : undefined,
      // display.none hides status-line values, never the settings control.
      display: m.display,
      type: m.type,
      defval: m.defval,
      options: m.options,
      minval: m.minval,
      maxval: m.maxval,
      step: m.step,
    })),
    plots: plots.map(([key, p]) => {
      const style = p.options.style || "line";
      if (
        ![
          "line",
          "style_line",
          "style_linebr",
          "style_stepline",
          "style_histogram",
          "style_columns",
          "hline",
        ].includes(style)
      )
        throw Error("plot style " + style + " ยังไม่รองรับ");
      if (p.options.offset && p.options.offset !== 0)
        throw Error("plot offset ยังไม่รองรับ");
      if (p.options.display && p.options.display !== "all")
        throw Error("plot display ยังไม่รองรับ");
      if (p.options.show_last) throw Error("plot show_last ยังไม่รองรับ");
      return {
        key,
        title: String(p.title || key).slice(0, 100),
        style:
          style === "style_histogram" || style === "style_columns"
            ? "histogram"
            : "line",
        step: style === "style_stepline",
        breakLine: style === "style_linebr",
        overlay: !!p.options.overlay,
        color: color(p.options.color),
        width: Math.min(4, Math.max(1, p.options.linewidth || 1)),
        data: p.data.flatMap((d) => {
          const time = d.time / 1000;
          if (!times.has(time)) return [];
          return [
            {
              time,
              value: Number.isFinite(d.value) ? d.value : null,
              color: color(d.options?.color || p.options.color),
            },
          ];
        }),
      };
    }),
  };
}
onmessage = async ({ data }) => {
  const { id, items, bars, symbol, timeframe, clock } = data;
  const results = [];
  try {
    if (
      !Array.isArray(bars) ||
      !bars.length ||
      bars.length > 2000 ||
      !Array.isArray(items) ||
      items.length > 8
    )
      throw Error("เกินขอบเขตข้อมูล Replay");
    // Pine's time/confirmation uses simulated clock, not today's wall clock.
    Date.now = () => clock;
    const seconds = {
      M1: 60,
      M5: 300,
      M15: 900,
      M30: 1800,
      H1: 3600,
      H4: 14400,
      D1: 86400,
    }[timeframe];
    if (!seconds) throw Error("TF ไม่รองรับ");
    const candles = bars.map((b) => ({
      openTime: b.time * 1000,
      closeTime: (b.time + seconds) * 1000,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
    for (const item of items) {
      try {
        validate(item.source);
        const key = JSON.stringify([item.source, item.inputs]);
        let script = scripts.get(key);
        if (!script) {
          script = new PineTSLib.Indicator(item.source, item.inputs);
          if (scripts.size >= 8) scripts.clear();
          scripts.set(key, script);
        }
        validateInputs(script, item.inputs);
        const engine = new PineTSLib.PineTS(
          candles,
          symbol,
          timeframe.startsWith("M")
            ? timeframe.slice(1)
            : timeframe === "D1"
              ? "D"
              : String(seconds / 60),
        );
        engine.setMaxLoops(10000);
        const ctx = await engine.run(script);
        results.push({
          id: item.id,
          result: result(ctx, script, bars, item.source),
        });
      } catch (e) {
        results.push({
          id: item.id,
          error: String(e.message || e).slice(0, 1200),
        });
      }
    }
    postMessage({ id, results });
  } catch (e) {
    postMessage({ id, error: String(e.message || e).slice(0, 1200) });
  } finally {
    Date.now = realNow;
  }
};
