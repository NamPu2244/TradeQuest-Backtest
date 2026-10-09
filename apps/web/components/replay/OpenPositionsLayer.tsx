"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { X } from "lucide-react";
import { num, signed } from "../types";
import type { Session } from "./types";
export default function OpenPositionsLayer({
  chart,
  series,
  host,
  session,
  busy,
  close,
  registerCleanup,
}: {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  host: HTMLDivElement;
  session: Session;
  busy: boolean;
  close: (id: string) => void;
  registerCleanup: (cleanup: () => void) => void;
}) {
  const [, refresh] = useState(0),
    alive = useRef(true),
    frame = useRef(0);
  const registration = useRef(registerCleanup);
  useLayoutEffect(() => {
    registration.current = registerCleanup;
  });
  useEffect(() => {
    alive.current = true;
    const recalc = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        if (alive.current) refresh((v) => v + 1);
      });
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(recalc);
    chart.subscribeCrosshairMove(recalc);
    const observer = new ResizeObserver(recalc);
    observer.observe(host);
    let disposed = false;
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      alive.current = false;
      cancelAnimationFrame(frame.current);
      observer.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(recalc);
      chart.unsubscribeCrosshairMove(recalc);
    };
    registration.current(cleanup);
    return cleanup;
  }, [chart, host]);
  const height = chart.paneSize(0).height,
    width = chart.paneSize(0).width;
  const rows = session.trades
    .flatMap((trade, index) => {
      if (trade.status !== "open" && trade.status !== "pending") return [];
      const price = trade.entry_price ?? trade.requested_entry;
      const y = price === null ? null : series.priceToCoordinate(price);
      return y === null
        ? []
        : [{ trade, index, y: Math.max(14, Math.min(height - 14, y)) }];
    })
    .sort((a, b) => a.y - b.y);
  let previous = -16;
  return (
    <div
      className="open-positions-layer"
      style={{ width, height }}
      data-testid="open-positions-layer"
    >
      {rows.map(({ trade, index, y }) => {
        const top = Math.max(y, previous + 30);
        previous = top;
        return (
          <div
            className="open-position-pill"
            data-testid={`chart-position-${trade.id}`}
            key={trade.id}
            style={{ top }}
          >
            <span>
              #{index + 1} {trade.side} ·{" "}
              {num(trade.remaining_lot ?? trade.decision.lot, 8)}
            </span>
            <strong
              className={
                (trade.floating_pnl || 0) >= 0 ? "positive" : "negative"
              }
              data-testid="chart-position-floating"
            >
              {trade.status === "open"
                ? `${signed(trade.floating_pnl)} ${session.config.currency || "USD"}`
                : "รอเข้า"}
            </strong>
            <button
              disabled={busy}
              aria-label={`ปิด Position #${index + 1} บนกราฟ`}
              onClick={(e) => {
                e.stopPropagation();
                close(trade.id);
              }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
