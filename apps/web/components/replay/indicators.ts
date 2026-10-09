// Values are calculated from revealed closed bars only. No future arrays are passed in.
export function ema(values: number[], period: number): (number | null)[] {
  let value = 0;
  const result: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period) {
      value += values[i];
      result.push(i === period - 1 ? value / period : null);
      if (i === period - 1) value /= period;
    } else {
      value += ((values[i] - value) * 2) / (period + 1);
      result.push(value);
    }
  }
  return result;
}
export function sma(values: number[], period: number): (number | null)[] {
  let sum = 0;
  return values.map((value, i) => {
    sum += value;
    if (i >= period) sum -= values[i - period];
    return i >= period - 1 ? sum / period : null;
  });
}
export function rsi(values: number[], period: number): (number | null)[] {
  let gain = 0,
    loss = 0;
  return values.map((value, i) => {
    if (!i) return null;
    const diff = value - values[i - 1];
    if (i <= period) {
      gain += Math.max(0, diff);
      loss += Math.max(0, -diff);
      if (i < period) return null;
      gain /= period;
      loss /= period;
    } else {
      gain = (gain * (period - 1) + Math.max(0, diff)) / period;
      loss = (loss * (period - 1) + Math.max(0, -diff)) / period;
    }
    return loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
  });
}
export function macd(
  values: number[],
  fast: number,
  slow: number,
  signal: number,
) {
  const f = ema(values, fast),
    s = ema(values, slow);
  const line = values.map((_, i) =>
    f[i] === null || s[i] === null ? null : f[i]! - s[i]!,
  );
  const offset = Math.max(fast, slow) - 1;
  const sig = ema(
    line.slice(offset).filter((v): v is number => v !== null),
    signal,
  );
  const signalLine = line.map((_, i) =>
    i < offset ? null : (sig[i - offset] ?? null),
  );
  return {
    line,
    signal: signalLine,
    histogram: line.map((v, i) =>
      v === null || signalLine[i] === null ? null : v - signalLine[i]!,
    ),
  };
}
