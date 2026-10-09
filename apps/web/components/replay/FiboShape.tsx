import type { Drawing, FiboSettings } from "./types";
import { fiboPrice, fiboSpan, lineDash, settingsForFibo } from "./fibo";
type Pixel = { x: number; y: number };
const position = (
  left: number,
  right: number,
  where: FiboSettings["label_position"],
) =>
  where === "left"
    ? left + 5
    : where === "right"
      ? right - 5
      : (left + right) / 2;
const anchor = (where: FiboSettings["label_position"]) =>
  where === "left" ? "start" : where === "right" ? "end" : "middle";
const offset = (where: FiboSettings["label_vertical"]) =>
  where === "top" ? -6 : where === "bottom" ? 14 : 0;
export default function FiboShape({
  drawing,
  a,
  b,
  width,
  priceCoordinate,
  temporary,
  interactive,
}: {
  drawing: Drawing;
  a: Pixel;
  b: Pixel;
  width: number;
  priceCoordinate: (price: number) => number | null;
  temporary: boolean;
  interactive: boolean;
}) {
  const settings = drawing.fibo ?? settingsForFibo(drawing),
    span = fiboSpan(a.x, b.x, width, settings.extend, !drawing.fibo);
  const levels = settings.levels.flatMap((level, index) => {
    if (!level.enabled) return [];
    const price = fiboPrice(drawing.points, level.value, settings.reverse),
      y = priceCoordinate(price);
    if (y === null || !Number.isFinite(y)) return [];
    return [
      {
        ...level,
        index,
        price,
        y,
        color: settings.single_color
          ? settings.single_color_value
          : level.color,
      },
    ];
  });
  const ordered = [...levels].sort((a, b) => a.y - b.y);
  return (
    <>
      {settings.background &&
        ordered
          .slice(1)
          .map((level, i) => (
            <rect
              key={level.index}
              data-testid="fibo-band"
              x={span.left}
              y={ordered[i].y}
              width={Math.max(0, span.right - span.left)}
              height={level.y - ordered[i].y}
              fill={level.color}
              opacity={settings.background_opacity / 100}
              pointerEvents="none"
            />
          ))}
      {settings.trend_line && (
        <g>
          <line
            data-testid="fibo-trend"
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={settings.trend_color}
            strokeWidth={drawing.line_width || 2}
            strokeDasharray={lineDash(settings.trend_style)}
            pointerEvents="none"
          />
          {!temporary && (
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="transparent"
              strokeWidth={18}
              style={{
                pointerEvents: interactive ? "stroke" : "none",
                cursor: drawing.locked ? "pointer" : "move",
                touchAction: "none",
              }}
            />
          )}
        </g>
      )}
      {levels.map((level) => (
        <g
          key={level.index}
          data-testid="fibo-level"
          data-level={level.value}
          data-price={level.price}
        >
          <line
            data-testid="fibo-level-line"
            x1={span.left}
            x2={span.right}
            y1={level.y}
            y2={level.y}
            stroke={level.color}
            strokeWidth={drawing.line_width || 2}
            strokeDasharray={lineDash(drawing.line_style)}
            pointerEvents="none"
          />
          {!temporary && (
            <line
              x1={span.left}
              x2={span.right}
              y1={level.y}
              y2={level.y}
              stroke="transparent"
              strokeWidth={18}
              style={{
                pointerEvents: interactive ? "stroke" : "none",
                cursor: drawing.locked ? "pointer" : "move",
                touchAction: "none",
              }}
            />
          )}
          {(settings.show_levels || settings.show_prices) && (
            <text
              data-testid="fibo-level-label"
              x={position(span.left, span.right, settings.label_position)}
              y={level.y + offset(settings.label_vertical)}
              textAnchor={anchor(settings.label_position)}
              dominantBaseline={
                settings.label_vertical === "center" ? "central" : undefined
              }
              fill={level.color}
              fontSize={settings.font_size}
              pointerEvents="none"
            >
              {[
                settings.show_levels
                  ? settings.level_format === "percent"
                    ? `${Number((level.value * 100).toFixed(6))}%`
                    : String(level.value)
                  : "",
                settings.show_prices
                  ? `(${Number(level.price.toFixed(8))})`
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            </text>
          )}
        </g>
      ))}
      {drawing.fibo && settings.show_text && (
        <text
          data-testid="fibo-text"
          x={position(span.left, span.right, settings.text_position)}
          y={
            settings.text_vertical === "center"
              ? (a.y + b.y) / 2
              : (settings.text_vertical === "top"
                  ? Math.min(a.y, b.y)
                  : Math.max(a.y, b.y)) + offset(settings.text_vertical)
          }
          textAnchor={anchor(settings.text_position)}
          dominantBaseline={
            settings.text_vertical === "center" ? "central" : undefined
          }
          fill={
            settings.single_color
              ? settings.single_color_value
              : drawing.color || "#d6b86c"
          }
          fontSize={settings.font_size}
          pointerEvents="none"
        >
          {drawing.label}
        </text>
      )}
    </>
  );
}
