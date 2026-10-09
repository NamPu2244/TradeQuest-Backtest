"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  ColorType,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type LineData,
  type HistogramData,
} from "lightweight-charts";
import type {
  Session,
  Drawing,
  PositionDraft,
  PositionGeometry,
} from "./types";
import { pineLayer } from "./pine-chart";
import type { PineReply } from "./pine-runtime";
import type { PineIndicator } from "./types";
import PositionTool from "./PositionTool";
import DrawingLayer from "./DrawingLayer";
import OpenPositionsLayer from "./OpenPositionsLayer";
import { intervals, logicalAtTime, timeAtLogical } from "./chart-coordinates";
import { ema, sma, rsi, macd } from "./indicators";
type ChartLifetime = {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  disposed: boolean;
  drawingDispose?: () => void;
  positionsDispose?: () => void;
  layers?: {
    signature: string;
    update: (state: Session) => void;
    recalc: () => void;
    dispose: () => void;
  };
};
export default function ReplayChart({
  session,
  tool,
  onDraw,
  onDrawingsChange,
  onDrawingInteract,
  onCancelTool,
  position,
  positionEditable = false,
  onPositionChange,
  onPositionSettings,
  onClosePosition,
  positionBusy = false,
}: {
  session: Session;
  tool: Drawing["kind"] | "";
  onDraw: (drawing: Drawing) => void | Promise<boolean>;
  onDrawingsChange?: (drawings: Drawing[]) => void | Promise<boolean>;
  onDrawingInteract?: () => void;
  onCancelTool?: () => void;
  position?: PositionDraft | null;
  positionEditable?: boolean;
  onPositionChange?: (draft: PositionDraft) => void;
  onPositionSettings?: () => void;
  onClosePosition?: (id: string) => void;
  positionBusy?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    lifetime = useRef<ChartLifetime | null>(null);
  const latest = useRef({ session, tool, onDraw, position });
  useLayoutEffect(() => {
    latest.current = { session, tool, onDraw, position };
  }, [session, tool, onDraw, position]);
  const [positionFrame, setPositionFrame] = useState<PositionGeometry | null>(
    null,
  );
  const [canvas, setCanvas] = useState<ChartLifetime | null>(null);
  const [pineStatus, setPineStatus] = useState<PineReply[]>([]);
  const previousBars = useRef(0);
  const previousFrame = useRef("");
  const previousData = useRef<{
    first: number;
    last: number;
    count: number;
  } | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const c = createChart(host.current, {
      autoSize: true,
      handleScroll: !latest.current.tool,
      handleScale: !latest.current.tool,
      height: 600,
      layout: {
        background: { type: ColorType.Solid, color: "#151e22" },
        textColor: "#b2b5be",
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#2d383e" },
        horzLines: { color: "#2d383e" },
      },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 16 },
      rightPriceScale: { borderColor: "#283744" },
      crosshair: { mode: 0 },
    });
    const precision = session.dataset.price_scale
      ? Math.round(Math.log10(session.dataset.price_scale))
      : 5;
    const s = c.addSeries(CandlestickSeries, {
      upColor: "#28a6f8",
      downColor: "#f23645",
      wickUpColor: "#28a6f8",
      wickDownColor: "#f23645",
      borderVisible: false,
      priceFormat: { type: "price", precision, minMove: 10 ** -precision },
    });
    previousBars.current = 0;
    const owner: ChartLifetime = { chart: c, candles: s, disposed: false };
    lifetime.current = owner;
    setCanvas(owner);
    return () => {
      owner.drawingDispose?.();
      owner.positionsDispose?.();
      // React can dispose the chart before the data effect cleans up its series.
      // This captured lifetime also protects old callbacks when a new chart mounts.
      owner.layers?.dispose();
      owner.disposed = true;
      c.remove();
      previousData.current = null;
      previousBars.current = 0;
      if (lifetime.current === owner) lifetime.current = null;
    };
  }, [session.id, session.dataset.price_scale]);
  useLayoutEffect(() => {
    lifetime.current?.chart.applyOptions({
      handleScroll: !tool,
      handleScale: !tool,
    });
  }, [tool, session.id]);
  useEffect(() => {
    const owner = lifetime.current;
    if (!owner || owner.disposed) return;
    const { chart: c, candles: s } = owner;
    let active = true;
    const tf = session.config.timeframe || session.dataset.timeframe;
    const changedFrame = previousFrame.current !== tf;
    previousFrame.current = tf;
    const seconds: Record<string, number> = {
      M1: 60,
      M5: 300,
      M15: 900,
      M30: 1800,
      H1: 3600,
      H4: 14400,
      D1: 86400,
    };
    const align = (time: number) =>
      Math.floor(time / seconds[tf]) * seconds[tf];
    const priorRange = changedFrame
      ? null
      : c.timeScale().getVisibleLogicalRange();
    const oldCount = previousBars.current;
    const follow = !priorRange || priorRange.to >= oldCount - 2;
    previousBars.current = session.bars.length;
    const before = previousData.current;
    const first = session.bars[0].time,
      last = session.bars.at(-1)!.time;
    if (
      !changedFrame &&
      before &&
      before.first === first &&
      before.last <= last &&
      before.count <= session.bars.length
    ) {
      // Reuse the candle series, including the last forming candle when a new bar arrives.
      for (const b of session.bars.slice(before.count - 1))
        s.update({ ...b, time: b.time as UTCTimestamp });
    } else {
      s.setData(
        session.bars.map((b) => ({ ...b, time: b.time as UTCTimestamp })),
      );
    }
    previousData.current = { first, last, count: session.bars.length };
    const setRange = () => {
      // Intrabar ticks never reset a user's scroll/zoom or schedule a range repaint.
      if (
        !changedFrame &&
        before?.first === first &&
        before.count === session.bars.length
      )
        return;
      const delta = session.bars.length - oldCount;
      c.timeScale().setVisibleLogicalRange(
        priorRange && oldCount > 0
          ? {
              from: priorRange.from + (follow ? delta : 0),
              to: priorRange.to + (follow ? delta : 0),
            }
          : {
              from: Math.max(0, session.bars.length - 90),
              to: session.bars.length + 16,
            },
      );
    };
    const signature = JSON.stringify({
      tf,
      indicators: session.indicators,
      workspace: session.config.workspace,
    });
    if (owner.layers?.signature === signature) {
      owner.layers.update(session);
      setRange();
      owner.layers.recalc();
      return;
    }
    owner.layers?.dispose();
    const priceLines: ReturnType<typeof s.createPriceLine>[] = [];
    const extras: ISeriesApi<"Line" | "Histogram">[] = [];
    const updates: ((state: Session) => void)[] = [];
    function bindData<T extends "Line" | "Histogram">(
      series: ISeriesApi<T>,
      read: (
        state: Session,
      ) => (T extends "Line"
        ? LineData<UTCTimestamp>
        : HistogramData<UTCTimestamp>)[],
    ) {
      let prior: {
        first: number;
        last: number;
        count: number;
        times: number[];
      } | null = null;
      updates.push((state) => {
        const data = read(state);
        const first = state.bars[0].time,
          last = state.bars.at(-1)!.time;
        const growing =
          prior &&
          prior.first === first &&
          prior.last <= last &&
          prior.count <= state.bars.length;
        // Null warmups can shrink/grow; a historical point disappearing requires replacement.
        const times = data.map((p) => Number(p.time));
        const revealedTimes = new Set(times);
        const retained =
          prior &&
          prior.times.every(
            (time) => time >= prior!.last || revealedTimes.has(time),
          );
        if (growing && retained) {
          for (const point of data.filter((p) => Number(p.time) >= prior!.last))
            series.update(point);
        } else series.setData(data);
        prior = { first, last, count: state.bars.length, times };
      });
    }
    const points = (state: Session, values: (number | null)[]) =>
      values.flatMap((value, index) =>
        value === null
          ? []
          : [{ time: state.bars[index].time as UTCTimestamp, value }],
      );
    const addLine = (
      read: (state: Session) => (number | null)[],
      color: string,
      pane: number,
      title: string,
    ) => {
      const series = c.addSeries(
        LineSeries,
        {
          color,
          lineWidth: 1,
          title,
          priceLineVisible: false,
          lastValueVisible: true,
        },
        pane,
      );
      bindData(series, (state) => points(state, read(state)));
      extras.push(series);
      return series;
    };
    let pane = 1;
    session.indicators.forEach((i, index) => {
      const color = ["#d6b86c", "#79aef8", "#c6a1ed", "#65cec5"][index % 4];
      const closes = (state: Session) => state.bars.map((b) => b.close);
      if (i.kind === "EMA" || i.kind === "SMA")
        addLine(
          (state) => (i.kind === "EMA" ? ema : sma)(closes(state), i.period),
          color,
          0,
          `${i.kind} ${i.period}`,
        );
      if (i.kind === "RSI") {
        const rs = addLine(
          (state) => rsi(closes(state), i.period),
          color,
          pane++,
          `RSI ${i.period}`,
        );
        [30, 50, 70].forEach((price) =>
          rs.createPriceLine({
            price,
            color: "#455b6e",
            lineStyle: 2,
            lineWidth: 1,
            axisLabelVisible: true,
          }),
        );
      }
      if (i.kind === "MACD") {
        let cached: { state: Session; values: ReturnType<typeof macd> } | null =
          null;
        const values = (state: Session) => {
          if (cached?.state !== state)
            cached = {
              state,
              values: macd(closes(state), i.fast, i.slow, i.signal),
            };
          return cached.values;
        };
        addLine(
          (state) => values(state).line,
          "#7baaf7",
          pane,
          `MACD ${i.fast}/${i.slow}/${i.signal}`,
        );
        addLine((state) => values(state).signal, "#d6b86c", pane, "Signal");
        const h = c.addSeries(
          HistogramSeries,
          { priceLineVisible: false, title: "Histogram" },
          pane++,
        );
        bindData(h, (state) =>
          points(state, values(state).histogram).map((p) => ({
            ...p,
            color: p.value >= 0 ? "#32977f" : "#b85d6c",
          })),
        );
        h.createPriceLine({
          price: 0,
          color: "#80909e",
          lineStyle: 2,
          lineWidth: 1,
          axisLabelVisible: true,
        });
        extras.push(h);
      }
      if (i.kind === "VOLUME") {
        const h = c.addSeries(
          HistogramSeries,
          {
            priceFormat: { type: "volume" },
            priceLineVisible: false,
            title: "Volume",
          },
          pane++,
        );
        bindData(h, (state) =>
          state.bars.map((b) => ({
            time: b.time as UTCTimestamp,
            value: b.volume,
            color: b.close >= b.open ? "#32977f" : "#b85d6c",
          })),
        );
        extras.push(h);
      }
    });
    const custom = session.indicators.filter(
      (i): i is PineIndicator => i.kind === "PINE",
    );
    const pine = custom.length
      ? pineLayer(c, s, custom, pane, setPineStatus)
      : null;
    setPineStatus([]);
    c.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 3.3 : 1));
    const positionLines = new Map<
      string,
      { line: ReturnType<typeof s.createPriceLine>; price: number }
    >();
    const updatePosition = (state: Session) => {
      const prices: [string, number, string][] = state.trades.flatMap(
        (open, index) => {
          if (!["open", "pending"].includes(open.status)) return [];
          const prefix =
            state.config.workspace === "backtest" ? `#${index + 1} ` : "";
          return [
            [prefix + "SL จำลอง", open.stop_price, "#f23645"],
            [prefix + "TP จำลอง", open.target_price, "#089981"],
            ...((open.entry_price ?? open.requested_entry) !== null
              ? [
                  [
                    prefix + "Entry จำลอง",
                    (open.entry_price ?? open.requested_entry)!,
                    "#79aef8",
                  ] as [string, number, string],
                ]
              : []),
          ];
        },
      );
      for (const [title, price, color] of prices) {
        const existing = positionLines.get(title);
        if (!existing)
          positionLines.set(title, {
            price,
            line: s.createPriceLine({
              price,
              title,
              color,
              lineStyle: 2,
              lineWidth: 1,
              axisLabelVisible: true,
            }),
          });
        else if (existing.price !== price) {
          existing.line.applyOptions({ price });
          existing.price = price;
        }
      }
      for (const [title, existing] of positionLines)
        if (!prices.some(([key]) => key === title)) {
          s.removePriceLine(existing.line);
          positionLines.delete(title);
        }
    };
    const markers = createSeriesMarkers(s, []);
    const markerData = (state: Session) => {
      const times = new Set(state.bars.map((b) => b.time));
      return state.trades
        .flatMap((t) => [
          ...(t.entry_time !== null &&
          (state.config.replay_mode !== "ticks" ||
            (t.decision.entry_tick_index ?? 0) <= state.cursor) &&
          (t.decision.entry_time_ms ?? t.entry_time * 1000) <=
            (state.quote?.time_ms ?? state.replay_time_ms ?? Infinity) &&
          times.has(align(t.entry_time))
            ? [
                {
                  time: align(t.entry_time!) as UTCTimestamp,
                  position:
                    t.side === "BUY"
                      ? ("belowBar" as const)
                      : ("aboveBar" as const),
                  shape:
                    t.side === "BUY"
                      ? ("arrowUp" as const)
                      : ("arrowDown" as const),
                  color: "#d6b86c",
                  text: t.side + " จำลอง",
                },
              ]
            : []),
          ...(t.exit_time !== null &&
          (state.config.replay_mode !== "ticks" ||
            (t.decision.exit_tick_index ?? 0) <= state.cursor) &&
          (t.decision.exit_time_ms ?? t.exit_time * 1000) <=
            (state.quote?.time_ms ?? state.replay_time_ms ?? Infinity) &&
          times.has(align(t.exit_time))
            ? [
                {
                  time: align(t.exit_time!) as UTCTimestamp,
                  position:
                    t.side === "BUY"
                      ? ("aboveBar" as const)
                      : ("belowBar" as const),
                  shape:
                    t.side === "BUY"
                      ? ("arrowDown" as const)
                      : ("arrowUp" as const),
                  color: "#93a4b5",
                  text: t.exit_reason || "EXIT",
                },
              ]
            : []),
        ])
        .sort((a, b) => a.time - b.time);
    };
    let lastMarkers = "";
    const update = (state: Session) => {
      updates.forEach((refresh) => refresh(state));
      pine?.update(state);
      updatePosition(state);
      const data = markerData(state),
        nextMarkers = JSON.stringify(data);
      if (nextMarkers !== lastMarkers) {
        markers.setMarkers(data);
        lastMarkers = nextMarkers;
      }
    };
    const recalc = () => {
      if (!active || owner.disposed) return;
      setPositionFrame(
        positionFrameFor(c, s, latest.current.session, latest.current.position),
      );
    };
    c.timeScale().subscribeVisibleLogicalRangeChange(recalc);
    c.subscribeCrosshairMove(recalc);
    const resize = new ResizeObserver(recalc);
    if (host.current) resize.observe(host.current);
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recalc);
    };
    // Resources belong to this chart lifetime, not to each session response.
    // Rebuild only when the chosen TF/visual configuration changes; disposal also runs on unmount.
    owner.layers = {
      signature,
      update,
      recalc: schedule,
      dispose: () => {
        active = false;
        cancelAnimationFrame(raf);
        resize.disconnect();
        if (owner.disposed) return;
        c.timeScale().unsubscribeVisibleLogicalRangeChange(recalc);
        c.unsubscribeCrosshairMove(recalc);
        markers.detach();
        priceLines.forEach((p) => s.removePriceLine(p));
        positionLines.forEach(({ line }) => s.removePriceLine(line));
        pine?.dispose();
        extras.reverse().forEach((p) => c.removeSeries(p));
        owner.layers = undefined;
      },
    };
    update(session);
    setRange();
    schedule();
  }, [session]);
  useEffect(() => {
    const owner = lifetime.current;
    if (owner && !owner.disposed) {
      setPositionFrame(
        positionFrameFor(owner.chart, owner.candles, session, position),
      );
    }
  }, [position, session]);
  return (
    <div className="replay-chart-wrap">
      {!!pineStatus.length && (
        <div className="pine-chart-status" aria-live="polite">
          {pineStatus.map((r) => (
            <span
              key={r.id}
              data-testid="pine-chart-result"
              data-script-id={r.id}
              data-drawing-count={r.result?.drawings.length}
              data-background-count={r.result?.backgrounds.length}
              data-last-value={r.result?.plots[0]?.data.at(-1)?.value ?? ""}
              data-last-time={r.result?.plots[0]?.data.at(-1)?.time ?? ""}
              className={r.error ? "pine-failed" : ""}
            >
              {r.error
                ? r.error
                : r.result?.title + " · Pine v" + r.result?.pineVersion}
            </span>
          ))}
        </div>
      )}

      <div
        className={"replay-chart " + (tool ? "drawing" : "")}
        ref={host}
        data-testid="replay-chart"
        data-last-time={session.bars.at(-1)?.time}
      />
      {position && positionFrame && (
        <PositionTool
          draft={position}
          geometry={positionFrame}
          editable={positionEditable}
          toPrice={(y) => {
            const owner = lifetime.current;
            return owner && !owner.disposed
              ? owner.candles.coordinateToPrice(y)
              : null;
          }}
          toTime={(x) => {
            const owner = lifetime.current;
            const bars = latest.current.session.bars;
            const tf =
              latest.current.session.config.timeframe ||
              latest.current.session.dataset.timeframe;
            const logical =
              owner && !owner.disposed
                ? owner.chart.timeScale().coordinateToLogical(x)
                : null;
            return logical === null || !bars.length
              ? null
              : timeAtLogical(bars, logical, intervals[tf]);
          }}
          shiftTime={(time, from, to) => {
            const state = latest.current.session,
              step =
                intervals[state.config.timeframe || state.dataset.timeframe];
            return timeAtLogical(
              state.bars,
              logicalAtTime(state.bars, time, step) +
                logicalAtTime(state.bars, to, step) -
                logicalAtTime(state.bars, from, step),
              step,
            );
          }}
          onChange={onPositionChange || (() => {})}
          onSettings={onPositionSettings || (() => {})}
        />
      )}
      {canvas && !canvas.disposed && host.current && onClosePosition && (
        <OpenPositionsLayer
          chart={canvas.chart}
          series={canvas.candles}
          host={host.current}
          session={session}
          busy={positionBusy}
          close={onClosePosition}
          registerCleanup={(cleanup) => {
            canvas.positionsDispose = cleanup;
          }}
        />
      )}
      {canvas && !canvas.disposed && host.current && (
        <DrawingLayer
          chart={canvas.chart}
          series={canvas.candles}
          host={host.current}
          session={session}
          tool={tool}
          onCreate={onDraw}
          onChange={onDrawingsChange}
          onInteract={onDrawingInteract}
          onCancelTool={onCancelTool}
          registerCleanup={(cleanup) => {
            canvas.drawingDispose = cleanup;
          }}
        />
      )}
    </div>
  );
}

function positionFrameFor(
  chart: IChartApi,
  candles: ISeriesApi<"Candlestick">,
  session: Session,
  position?: PositionDraft | null,
): PositionGeometry | null {
  if (!position || !session.bars.length) return null;
  const size = chart.paneSize(0),
    scale = chart.timeScale();
  const step = intervals[session.config.timeframe || session.dataset.timeframe];
  const left = scale.logicalToCoordinate(
    logicalAtTime(session.bars, position.time, step),
  );
  const end =
    position.end_time ??
    timeAtLogical(
      session.bars,
      logicalAtTime(session.bars, position.time, step) + 12,
      step,
    );
  const right = scale.logicalToCoordinate(
    logicalAtTime(session.bars, end, step),
  );
  const entry = candles.priceToCoordinate(position.entry),
    sl = candles.priceToCoordinate(position.sl),
    tp = candles.priceToCoordinate(position.tp);
  if (
    left === null ||
    right === null ||
    entry === null ||
    sl === null ||
    tp === null ||
    size.width < 70
  )
    return null;
  return { left, right, entry, sl, tp, height: size.height, width: size.width };
}
