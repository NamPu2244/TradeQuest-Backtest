import type { Drawing, FiboSettings, Point } from "./types";
export const fiboTimeframes = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
const referenceLevels: [number, boolean, string][] = [
  [0, true, "#2962ff"],
  [0.25, true, "#f23645"],
  [0.5, true, "#4caf50"],
  [0.75, true, "#4caf50"],
  [1, true, "#9c27b0"],
  [0.786, false, "#00bcd4"],
  [-1, true, "#787b86"],
  [2, true, "#2962ff"],
  [-2, true, "#a1887f"],
  [3, true, "#9c27b0"],
  [-0.5, true, "#e91e63"],
  [1.5, true, "#fbc02d"],
  [1.414, false, "#f23645"],
  [2.272, false, "#ff9800"],
  [2.414, false, "#4caf50"],
  [2, false, "#089981"],
  [3, false, "#00bcd4"],
  [3.272, false, "#787b86"],
  [3.414, false, "#2962ff"],
  [4, false, "#f23645"],
  [4.272, false, "#9c27b0"],
  [4.414, false, "#e91e63"],
  [4.618, false, "#ff9800"],
  [4.764, false, "#089981"],
];
export function defaultFibo(): FiboSettings {
  return {
    levels: referenceLevels.map(([value, enabled, color]) => ({
      value,
      enabled,
      color,
    })),
    extend: "right",
    reverse: false,
    trend_line: true,
    trend_color: "#787b86",
    trend_style: "dashed",
    background: false,
    background_opacity: 15,
    single_color: false,
    single_color_value: "#2962ff",
    show_prices: true,
    show_levels: true,
    level_format: "value",
    label_position: "left",
    label_vertical: "center",
    show_text: true,
    text_position: "center",
    text_vertical: "top",
    font_size: 12,
    timeframes: [...fiboTimeframes],
  };
}
// Missing settings identify legacy drawings; opening their dialog never changes them.
export function settingsForFibo(drawing: Drawing): FiboSettings {
  if (drawing.fibo) return structuredClone(drawing.fibo);
  return {
    ...defaultFibo(),
    levels: [0, 0.5, 1].map((value) => ({
      value,
      enabled: true,
      color: drawing.color || "#d6b86c",
    })),
    extend: "none",
    trend_line: false,
    show_prices: false,
    level_format: "percent",
    label_vertical: "top",
    text_position: "left",
    font_size: 11,
  };
}
export function fiboPrice(points: Point[], level: number, reverse: boolean) {
  const [a, b] = reverse ? [points[1], points[0]] : points;
  return a.price + (b.price - a.price) * level;
}
export function fiboSpan(
  a: number,
  b: number,
  width: number,
  extend: FiboSettings["extend"],
  legacy = false,
) {
  const left = Math.min(a, b),
    right = Math.max(a, b, legacy ? left + 80 : left);
  return {
    left: extend === "left" || extend === "both" ? Math.min(0, left) : left,
    right:
      extend === "right" || extend === "both"
        ? Math.max(width, right)
        : legacy
          ? Math.min(width, right)
          : right,
  };
}
export const lineDash = (style?: Drawing["line_style"]) =>
  style === "dashed" ? "8 5" : style === "dotted" ? "2 5" : undefined;
