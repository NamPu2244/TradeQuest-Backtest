import type { Logical } from "lightweight-charts";
import type { Point } from "./types";

export const intervals: Record<string, number> = {
  M1: 60,
  M5: 300,
  M15: 900,
  M30: 1800,
  H1: 3600,
  H4: 14400,
  D1: 86400,
};
type BarTime = { time: number };
// Interpolate only revealed timestamps. Whitespace is a drawing coordinate,
// never a request for an unrevealed candle or tick.
export function timeAtLogical(
  bars: BarTime[],
  logical: number,
  interval: number,
): number {
  const last = bars.length - 1;
  if (logical <= 0) return Math.round(bars[0].time + logical * interval);
  if (logical >= last)
    return Math.round(bars[last].time + (logical - last) * interval);
  const i = Math.floor(logical);
  return Math.round(
    bars[i].time + (bars[i + 1].time - bars[i].time) * (logical - i),
  );
}
export function logicalAtTime(
  bars: BarTime[],
  time: number,
  interval: number,
): Logical {
  const last = bars.length - 1;
  if (time <= bars[0].time)
    return ((time - bars[0].time) / interval) as Logical;
  if (time >= bars[last].time)
    return (last + (time - bars[last].time) / interval) as Logical;
  let low = 0,
    high = last;
  while (high - low > 1) {
    const mid = (low + high) >>> 1;
    if (bars[mid].time <= time) low = mid;
    else high = mid;
  }
  return (low +
    (time - bars[low].time) / (bars[high].time - bars[low].time)) as Logical;
}
export function translatedPoints(
  points: Point[],
  start: Point,
  end: Point,
  bars: BarTime[],
  interval: number,
): Point[] {
  const shift =
    logicalAtTime(bars, end.time, interval) -
    logicalAtTime(bars, start.time, interval);
  return points.map((p) => ({
    time: timeAtLogical(
      bars,
      logicalAtTime(bars, p.time, interval) + shift,
      interval,
    ),
    price: p.price + end.price - start.price,
  }));
}
export type BoxHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export function resizeBox(
  points: Point[],
  handle: BoxHandle,
  point: Point,
): Point[] {
  const next = points.map((p) => ({ ...p }));
  const west = points[0].time <= points[1].time ? 0 : 1;
  const north = points[0].price >= points[1].price ? 0 : 1;
  if (handle.includes("w")) next[west].time = point.time;
  if (handle.includes("e")) next[1 - west].time = point.time;
  if (handle.includes("n")) next[north].price = point.price;
  if (handle.includes("s")) next[1 - north].price = point.price;
  return next;
}
