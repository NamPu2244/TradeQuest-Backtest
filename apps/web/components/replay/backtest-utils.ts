import type { Indicator } from "./types";
export const timeLabel = (time: number) =>
  new Date(time * 1000).toLocaleString("th-TH-u-ca-gregory");
export const toolNames = {
  horizontal: "แนวรับ/ต้าน",
  trend: "Trendline",
  zone: "Zone / OB",
  fibo: "Fib Retracement",
};
export const indicatorName = (i: Indicator) =>
  i.kind === "PINE"
    ? `${i.name} · v${i.script_version}`
    : i.kind === "MACD"
      ? `MACD ${i.fast}/${i.slow}/${i.signal}`
      : i.kind === "VOLUME"
        ? "Volume"
        : `${i.kind} ${i.period}`;
