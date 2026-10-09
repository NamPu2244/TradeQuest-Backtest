import { test, expect } from "@playwright/test";
import {
  logicalAtTime,
  timeAtLogical,
  translatedPoints,
  resizeBox,
  type BoxHandle,
} from "../components/replay/chart-coordinates";
test("free chart coordinates interpolate fractional bars and extrapolate whitespace using only revealed timestamps", () => {
  const bars = [{ time: 1000 }, { time: 1300 }, { time: 2500 }];
  for (const logical of [-5, 0, 0.5, 1, 1.25, 2, 3, 10.5]) {
    const time = timeAtLogical(bars, logical, 300);
    expect(logicalAtTime(bars, time, 300)).toBeCloseTo(logical, 5);
  }
  expect(timeAtLogical(bars, 1.5, 300)).toBe(1900);
  expect(timeAtLogical(bars, 5, 300)).toBe(3400);
  const points = [
    { time: 1150, price: 101 },
    { time: 2800, price: 99 },
  ];
  const before = structuredClone(points);
  const moved = translatedPoints(
    points,
    { time: 1300, price: 100 },
    { time: 3100, price: 102 },
    bars,
    300,
  );
  expect(
    logicalAtTime(bars, moved[1].time, 300) -
      logicalAtTime(bars, moved[0].time, 300),
  ).toBeCloseTo(2.5);
  expect(moved.map((p) => p.price)).toEqual([103, 101]);
  expect(points).toEqual(before);
});
test("all eight box handles resize the intended edges regardless of original anchor order and permit crossing", () => {
  const points = [
    { time: 2000, price: 99 },
    { time: 1000, price: 101 },
  ];
  const cursor = { time: 3000, price: 102 };
  for (const handle of [
    "nw",
    "n",
    "ne",
    "e",
    "se",
    "s",
    "sw",
    "w",
  ] as BoxHandle[]) {
    const next = resizeBox(points, handle, cursor);
    expect(next[0].time).toBe(handle.includes("e") ? 3000 : 2000);
    expect(next[1].time).toBe(handle.includes("w") ? 3000 : 1000);
    expect(next[0].price).toBe(handle.includes("s") ? 102 : 99);
    expect(next[1].price).toBe(handle.includes("n") ? 102 : 101);
  }
  expect(points).toEqual([
    { time: 2000, price: 99 },
    { time: 1000, price: 101 },
  ]);
});

import {
  fiboPrice,
  fiboSpan,
  settingsForFibo,
} from "../components/replay/fibo";
test("Fibonacci prices include negative extensions and reverse without depending on pixel scale", () => {
  const points = [
    { time: 1000, price: 100 },
    { time: 1300, price: 120 },
  ];
  expect(fiboPrice(points, -0.5, false)).toBe(90);
  expect(fiboPrice(points, 1.5, false)).toBe(130);
  expect(fiboPrice(points, 0.25, true)).toBe(115);
  expect(fiboPrice([...points].reverse(), 0.25, false)).toBe(115);
  expect(fiboSpan(200, 100, 500, "none")).toEqual({ left: 100, right: 200 });
  expect(fiboSpan(200, 100, 500, "both")).toEqual({ left: 0, right: 500 });
  expect(fiboSpan(-100, 600, 500, "both")).toEqual({ left: -100, right: 600 });
  expect(fiboSpan(100, 110, 500, "none", true)).toEqual({
    left: 100,
    right: 180,
  });
  const legacy = settingsForFibo({
    id: "old",
    kind: "fibo",
    label: "Original",
    points,
    color: "#123456",
  });
  expect(legacy.levels.map((l) => l.value)).toEqual([0, 0.5, 1]);
  expect(legacy.levels.every((l) => l.color === "#123456")).toBeTruthy();
  expect(legacy.trend_line).toBe(false);
  expect(legacy.extend).toBe("none");
  expect(legacy.show_prices).toBe(false);
});
