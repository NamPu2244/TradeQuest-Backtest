import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  SeriesAttachedParameter,
  Logical,
} from "lightweight-charts";
import { logicalAtTime, intervals } from "./chart-coordinates";
import type { Session } from "./types";
import type { PineReply, PineDrawing } from "./pine-runtime";

/** Native chart primitive: price/time coordinates are recalculated on every pan,
 * zoom and resize. Indicator output is read-only and never joins manual drawings. */
export class PineGraphics implements ISeriesPrimitive {
  private redraw = () => {};
  private replies: PineReply[] = [];
  private state?: Session;
  private views: IPrimitivePaneView[];
  constructor(
    private chart: IChartApi,
    private candles: ISeriesApi<"Candlestick">,
  ) {
    this.views = ([true, false] as const).map((background) => {
      const renderer: IPrimitivePaneRenderer = {
        draw: (target) =>
          target.useMediaCoordinateSpace(({ context, mediaSize }) => {
            context.save();
            context.beginPath();
            context.rect(0, 0, mediaSize.width, mediaSize.height);
            context.clip();
            this.paint(context, mediaSize.width, mediaSize.height, background);
            context.restore();
          }),
      };
      return {
        zOrder: () => (background ? "bottom" : "normal"),
        renderer: () => renderer,
      };
    });
  }
  attached({ requestUpdate }: SeriesAttachedParameter) {
    this.redraw = requestUpdate;
  }
  detached() {
    this.redraw = () => {};
    this.replies = [];
  }
  paneViews() {
    return this.views;
  }
  update(replies: PineReply[], state: Session) {
    this.replies = replies;
    this.state = state;
    this.redraw();
  }
  clear() {
    this.replies = [];
    this.redraw();
  }
  private paint(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    background: boolean,
  ) {
    const s = this.state;
    if (!s?.bars.length) return;
    const ts = this.chart.timeScale();
    const interval =
      intervals[s.config.timeframe || s.dataset.timeframe] || 300;
    // Lightweight Charts 5 returns 0 for fractional logical indices.
    // Interpolate adjacent integer coordinates for mid-bar timestamps/edges.
    const pixel = (logical: number) => {
      const i = Math.floor(logical);
      const a = ts.logicalToCoordinate(i as Logical),
        b = ts.logicalToCoordinate((i + 1) as Logical);
      return a === null || b === null ? null : a + (b - a) * (logical - i);
    };
    const x = (v: number, loc: string) =>
      pixel(loc === "bi" ? v : logicalAtTime(s.bars, v / 1000, interval));
    const y = (v: number) => this.candles.priceToCoordinate(v);
    const dash = (style?: string) =>
      ctx.setLineDash(
        style?.includes("dotted")
          ? [2, 3]
          : style?.includes("dashed")
            ? [6, 4]
            : [],
      );
    const fontSize = (size?: string) =>
      ({ tiny: 9, small: 11, normal: 13, large: 16, huge: 20 })[
        size || "normal"
      ] || 12;
    const text = (
      value: string,
      px: number,
      py: number,
      color: string,
      size?: string,
      align: CanvasTextAlign = "center",
    ) => {
      ctx.fillStyle = color;
      ctx.font = `${fontSize(size)}px sans-serif`;
      ctx.textAlign = align;
      ctx.textBaseline = "middle";
      value
        .split("\n")
        .slice(0, 10)
        .forEach((line, i) =>
          ctx.fillText(line, px, py + i * (fontSize(size) + 2)),
        );
    };
    for (const reply of this.replies) {
      if (!reply.result) continue;
      if (background)
        for (const b of reply.result.backgrounds) {
          const logical = logicalAtTime(s.bars, b.time, interval);
          const l = pixel(logical - 0.5),
            r = pixel(logical + 0.5);
          if (l === null || r === null || r < 0 || l > width) continue;
          ctx.fillStyle = b.color;
          ctx.fillRect(l, 0, r - l, height);
        }
      for (const d of reply.result.drawings) {
        if (d.kind === "box") {
          const a = x(d.left!, d.xloc),
            b = x(d.right!, d.xloc),
            c = y(d.top!),
            e = y(d.bottom!);
          if (a === null || b === null || c === null || e === null) continue;
          const left =
            d.extend === "left" || d.extend === "both" ? 0 : Math.min(a, b);
          const right =
            d.extend === "right" || d.extend === "both"
              ? width
              : Math.max(a, b);
          const top = Math.min(c, e),
            bottom = Math.max(c, e);
          if (right < 0 || left > width || bottom < 0 || top > height) continue;
          if (background) {
            ctx.fillStyle = d.bgcolor!;
            ctx.fillRect(left, top, right - left, bottom - top);
          } else {
            ctx.strokeStyle = d.border_color!;
            ctx.lineWidth = d.border_width || 0;
            dash(d.border_style);
            if (d.border_width)
              ctx.strokeRect(left, top, right - left, bottom - top);
            if (d.text) {
              // Box text stays inside its box, including after zooming.
              ctx.save();
              ctx.beginPath();
              ctx.rect(left, top, right - left, bottom - top);
              ctx.clip();
              const align = (
                ["left", "right"].includes(d.text_halign || "")
                  ? d.text_halign
                  : "center"
              ) as CanvasTextAlign;
              const px =
                align === "left"
                  ? left + 4
                  : align === "right"
                    ? right - 4
                    : (left + right) / 2;
              const py =
                d.text_valign === "top"
                  ? top + 9
                  : d.text_valign === "bottom"
                    ? bottom - 9
                    : (top + bottom) / 2;
              text(d.text, px, py, d.text_color!, d.text_size, align);
              ctx.restore();
            }
          }
        } else if (!background && d.kind === "line") {
          const a = x(d.x1!, d.xloc),
            b = x(d.x2!, d.xloc),
            c = y(d.y1!),
            e = y(d.y2!);
          if (a === null || b === null || c === null || e === null) continue;
          let left: number = Math.min(a, b),
            right: number = Math.max(a, b),
            top: number = a <= b ? c : e,
            bottom: number = a <= b ? e : c;
          if (a !== b) {
            const slope = (e - c) / (b - a);
            // Extend towards the geometric left/right regardless of anchor order.
            if (d.extend === "left" || d.extend === "both") {
              left = 0;
              top = c + (0 - a) * slope;
            }
            if (d.extend === "right" || d.extend === "both") {
              right = width;
              bottom = c + (width - a) * slope;
            }
          } else if (d.extend && d.extend !== "none") {
            top = 0;
            bottom = height;
          }
          ctx.strokeStyle = d.color!;
          ctx.lineWidth = d.width || 1;
          dash(d.style);
          ctx.beginPath();
          ctx.moveTo(left, top);
          ctx.lineTo(right, bottom);
          ctx.stroke();
        } else if (!background && d.kind === "label") {
          const px = x(d.x!, d.xloc),
            py = y(d.y!);
          if (px === null || py === null || px < -500 || px > width + 500)
            continue;
          this.label(ctx, d, px, py, text, fontSize(d.size));
        }
      }
    }
  }
  private label(
    ctx: CanvasRenderingContext2D,
    d: PineDrawing,
    x: number,
    y: number,
    text: (
      v: string,
      x: number,
      y: number,
      c: string,
      size?: string,
      align?: CanvasTextAlign,
    ) => void,
    size: number,
  ) {
    const style = d.style || "style_none";
    const down = style.includes("down"),
      up = style.includes("up");
    const lines = (d.text || "").split("\n").slice(0, 10);
    ctx.font = `${size}px sans-serif`;
    const w = Math.max(...lines.map((t) => ctx.measureText(t).width), 2) + 8,
      h = lines.length * (size + 2) + 6;
    const left = x - w / 2,
      top = down ? y - h - 5 : up ? y + 5 : y - h / 2;
    if (style !== "style_none") {
      ctx.fillStyle = d.color!;
      ctx.fillRect(left, top, w, h);
      if (up || down) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 4, down ? top + h : top);
        ctx.lineTo(x + 4, down ? top + h : top);
        ctx.fill();
      }
    }
    const align = (
      ["left", "right"].includes(d.textalign || "") ? d.textalign : "center"
    ) as CanvasTextAlign;
    text(
      d.text || "",
      align === "left" ? left + 4 : align === "right" ? left + w - 4 : x,
      top + size / 2 + 4,
      d.textcolor!,
      d.size,
      align,
    );
  }
}
