import {
  LineSeries,
  HistogramSeries,
  LineType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { PineGraphics } from "./pine-graphics";
import type { PineIndicator, Session } from "./types";
import { PineSandbox, pineRequest, type PineReply } from "./pine-runtime";
export function pineLayer(
  chart: IChartApi,
  candles: ISeriesApi<"Candlestick">,
  indicators: PineIndicator[],
  firstPane: number,
  report: (r: PineReply[]) => void,
) {
  const sandbox = new PineSandbox();
  const graphics = new PineGraphics(chart, candles);
  candles.attachPrimitive(graphics);
  const series = new Map<string, ISeriesApi<"Line" | "Histogram">>();
  const panes = new Map<string, number>();
  let nextPane = firstPane,
    disposed = false,
    running = false,
    pending: Session | undefined,
    generation = 0,
    lastClock = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const drain = async () => {
    if (disposed || running || !pending) return;
    const state = pending,
      runGeneration = generation;
    pending = undefined;
    running = true;
    try {
      const replies = await sandbox.run(pineRequest(state, indicators));
      if (disposed || runGeneration !== generation) return;
      for (const reply of replies) {
        if (!reply.result) {
          // Erase stale values after a failed run instead of leaving a misleading signal.
          for (const [key, s] of series)
            if (key.startsWith(reply.id + ":")) s.setData([]);
          continue;
        }
        const liveKeys = new Set<string>();
        for (const plot of reply.result.plots) {
          const key = reply.id + ":" + plot.key;
          liveKeys.add(key);
          let s = series.get(key);
          if (!s) {
            let pane = 0;
            if (!plot.overlay) {
              if (!panes.has(reply.id)) panes.set(reply.id, nextPane++);
              pane = panes.get(reply.id)!;
            }
            s = chart.addSeries(
              plot.style === "histogram" ? HistogramSeries : LineSeries,
              { title: plot.title, color: plot.color, priceLineVisible: false },
              pane,
            );
            series.set(key, s);
            chart
              .panes()
              .forEach((p, i) => p.setStretchFactor(i === 0 ? 3.3 : 1));
          }
          if (plot.style === "line")
            (s as ISeriesApi<"Line">).applyOptions({
              color: plot.color,
              lineWidth: plot.width,
              lineType: plot.step ? LineType.WithSteps : LineType.Simple,
            });
          s.setData(
            plot.data.map((p) =>
              p.value === null
                ? { time: p.time as UTCTimestamp }
                : {
                    time: p.time as UTCTimestamp,
                    value: p.value,
                    color: p.color,
                  },
            ),
          );
        }
        for (const [key, s] of series)
          if (key.startsWith(reply.id + ":") && !liveKeys.has(key))
            s.setData([]);
      }
      graphics.update(replies, state);
      report(replies);
    } catch (e) {
      if (!disposed && runGeneration === generation) {
        graphics.clear();
        for (const s of series.values()) s.setData([]);
        report(
          indicators.map((i) => ({
            id: i.id,
            error: String((e as Error).message),
          })),
        );
      }
    } finally {
      running = false;
      if (!disposed && pending)
        timer = setTimeout(() => {
          timer = undefined;
          void drain();
        }, 50);
    }
  };
  return {
    update: (s: Session) => {
      pending = s;
      const clock = pineRequest(s, indicators).clock;
      if (clock < lastClock) {
        generation++;
        for (const layer of series.values()) layer.setData([]);
        graphics.clear();
        report([]);
      }
      lastClock = clock;
      if (!running && !timer)
        timer = setTimeout(() => {
          timer = undefined;
          void drain();
        }, 60);
    },
    dispose: () => {
      disposed = true;
      clearTimeout(timer);
      sandbox.dispose();
      candles.detachPrimitive(graphics);
      for (const s of [...series.values()].reverse()) chart.removeSeries(s);
      series.clear();
    },
  };
}
