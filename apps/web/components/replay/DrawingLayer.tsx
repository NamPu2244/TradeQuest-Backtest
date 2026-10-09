"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { m } from "motion/react";
import {
  LockKeyhole,
  UnlockKeyhole,
  Trash2,
  Pencil,
  Palette,
  X,
  Settings2,
  Copy,
} from "lucide-react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import Modal from "../Modal";
import FiboSettingsModal from "./FiboSettingsModal";
import FiboShape from "./FiboShape";
import { defaultFibo, settingsForFibo } from "./fibo";
import type { Drawing, Point, Session } from "./types";
import {
  intervals,
  logicalAtTime,
  timeAtLogical,
  translatedPoints,
  resizeBox,
  type BoxHandle,
} from "./chart-coordinates";

const names = {
  horizontal: "แนวรับ/ต้าน",
  trend: "Trendline",
  zone: "Zone / OB",
  fibo: "Fib Retracement",
};
const colors = [
  "#d6b86c",
  "#79aef8",
  "#ee7784",
  "#4bc4a8",
  "#c6a1ed",
  "#e3e8ef",
];
type Pixel = { x: number; y: number };
export default function DrawingLayer({
  chart,
  series,
  host,
  session,
  tool,
  onCreate,
  onChange,
  onInteract,
  onCancelTool,
  registerCleanup,
}: {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  host: HTMLDivElement;
  session: Session;
  tool: Drawing["kind"] | "";
  onCreate: (drawing: Drawing) => void | Promise<boolean>;
  onChange?: (drawings: Drawing[]) => void | Promise<boolean>;
  onInteract?: () => void;
  onCancelTool?: () => void;
  registerCleanup: (cleanup: () => void) => void;
}) {
  const latest = useRef({
    session,
    tool,
    onCreate,
    onChange,
    onInteract,
    onCancelTool,
  });
  useLayoutEffect(() => {
    latest.current = {
      session,
      tool,
      onCreate,
      onChange,
      onInteract,
      onCancelTool,
    };
  });
  const cleanupRegistration = useRef(registerCleanup);
  useLayoutEffect(() => {
    cleanupRegistration.current = registerCleanup;
  });
  const overlay = useRef<SVGSVGElement>(null);
  const alive = useRef(true),
    anchor = useRef<Point | null>(null),
    saving = useRef(false);
  const [removed, setRemoved] = useState<string | null>(null);
  const [selected, select] = useState<string | null>(null),
    [working, setWorking] = useState<Drawing | null>(null),
    [preview, setPreview] = useState<Drawing | null>(null),
    [busy, setBusy] = useState(false),
    [hint, setHint] = useState(""),
    [settings, setSettings] = useState(false);
  const workingRef = useRef<Drawing | null>(null);
  const drag = useRef<{
    initial: Drawing;
    start: Point;
    handle: number | BoxHandle | null;
    pointer: number;
    changed: boolean;
  } | null>(null);
  const [, redraw] = useState(0);
  const frame = useRef(0);
  const paint = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (alive.current) redraw((v) => v + 1);
    });
  };
  const edit = (drawing: Drawing | null) => {
    workingRef.current = drawing;
    setWorking(drawing);
  };
  const interval =
    intervals[session.config.timeframe || session.dataset.timeframe] || 60;
  const project = (point: Point): Pixel | null => {
    const x = chart
        .timeScale()
        .logicalToCoordinate(
          logicalAtTime(latest.current.session.bars, point.time, interval),
        ),
      y = series.priceToCoordinate(point.price);
    return x === null || y === null ? null : { x, y };
  };
  const pointAt = (x: number, y: number): Point | null => {
    const bars = latest.current.session.bars;
    const logical = chart.timeScale().coordinateToLogical(x),
      price = series.coordinateToPrice(y);
    if (
      logical === null ||
      price === null ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !bars.length
    )
      return null;
    return {
      time: timeAtLogical(bars, logical, interval),
      price,
    };
  };
  const commit = async (drawing: Drawing | null, create = false) => {
    if (saving.current) return;
    const state = latest.current;
    if (!create && !state.onChange) return;
    const id = drawing?.id || selected;
    saving.current = true;
    setBusy(true);
    edit(drawing);
    if (!drawing) setRemoved(id);
    state.onInteract?.();
    if (drawing) select(drawing.id);
    let ok = false;
    try {
      const result =
        create && drawing
          ? await state.onCreate(drawing)
          : await state.onChange!(
              state.session.drawings.flatMap((d) =>
                d.id === id ? (drawing ? [drawing] : []) : [d],
              ),
            );
      ok = result !== false;
    } catch {
      ok = false;
    } finally {
      saving.current = false;
      if (alive.current) {
        setBusy(false);
        setRemoved(null);
        edit(null);
        if (!drawing || (!ok && create)) select(null);
      }
    }
    return ok;
  };
  const callbacks = useRef({ commit, pointAt, paint });
  useLayoutEffect(() => {
    callbacks.current = { commit, pointAt, paint };
  });
  useEffect(() => {
    anchor.current = null;
    setPreview(null);
    setHint("");
    if (tool) select(null);
  }, [tool, session.id]);
  useEffect(() => {
    alive.current = true;
    const recalc = () => callbacks.current.paint();
    chart.timeScale().subscribeVisibleLogicalRangeChange(recalc);
    chart.subscribeCrosshairMove(recalc);
    const resize = new ResizeObserver(recalc);
    resize.observe(host);
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || saving.current) return;
      const mode = latest.current.tool;
      if (!mode) {
        select(null);
        return;
      }
      const rect = host.getBoundingClientRect(),
        x = event.clientX - rect.left,
        y = event.clientY - rect.top,
        size = chart.paneSize(0);
      if (x < 0 || x > size.width || y < 0 || y > size.height) return;
      const point = callbacks.current.pointAt(x, y);
      if (!point) return;
      event.preventDefault();
      event.stopPropagation();
      latest.current.onInteract?.();
      select(null);
      if (mode === "horizontal") {
        void callbacks.current.commit(
          {
            id: crypto.randomUUID(),
            kind: mode,
            points: [point],
            label: names[mode],
          },
          true,
        );
        return;
      }
      if (!anchor.current) {
        anchor.current = point;
        setPreview({
          id: "preview",
          kind: mode,
          points: [point, point],
          label: names[mode],
          ...(mode === "fibo" ? { fibo: defaultFibo() } : {}),
        });
        setHint("เลื่อนไปจุดปลาย แล้วแตะอีกครั้ง · Esc ยกเลิก");
        return;
      }
      if (mode === "trend" && point.time === anchor.current.time) {
        setHint("เลื่อนจุดปลายไปอีกแท่ง");
        return;
      }
      const drawing: Drawing = {
        id: crypto.randomUUID(),
        kind: mode,
        points: [anchor.current, point],
        label: names[mode],
        ...(mode === "fibo" ? { fibo: defaultFibo() } : {}),
      };
      anchor.current = null;
      setPreview(null);
      setHint("");
      void callbacks.current.commit(drawing, true);
    };
    let moveFrame = 0;
    const move = (event: PointerEvent) => {
      const mode = latest.current.tool;
      if (!mode || saving.current) return;
      const rect = host.getBoundingClientRect(),
        x = event.clientX - rect.left,
        y = event.clientY - rect.top,
        size = chart.paneSize(0);
      if (x < 0 || x > size.width || y < 0 || y > size.height) return;
      const point = callbacks.current.pointAt(x, y);
      if (!point) return;
      cancelAnimationFrame(moveFrame);
      moveFrame = requestAnimationFrame(() => {
        if (alive.current && latest.current.tool === mode)
          setPreview(
            mode === "horizontal"
              ? {
                  id: "preview",
                  kind: mode,
                  points: [point],
                  label: names[mode],
                }
              : anchor.current
                ? {
                    id: "preview",
                    kind: mode,
                    points: [anchor.current, point],
                    label: names[mode],
                    ...(mode === "fibo" ? { fibo: defaultFibo() } : {}),
                  }
                : null,
          );
      });
    };
    host.addEventListener("pointerdown", down, true);
    host.addEventListener("pointermove", move);
    let disposed = false;
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      alive.current = false;
      cancelAnimationFrame(frame.current);
      cancelAnimationFrame(moveFrame);
      resize.disconnect();
      host.removeEventListener("pointerdown", down, true);
      host.removeEventListener("pointermove", move);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(recalc);
      chart.unsubscribeCrosshairMove(recalc);
    };
    cleanupRegistration.current(cleanup);
    return cleanup;
  }, [chart, series, host]);
  useLayoutEffect(() => {
    callbacks.current.paint();
  }, [session]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest?.(
          "input,textarea,select,button,[contenteditable=true],[role=dialog]",
        )
      )
        return;
      if (event.key === "Escape") {
        anchor.current = null;
        setPreview(null);
        setHint("");
        select(null);
        setSettings(false);
        latest.current.onCancelTool?.();
      }
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selected &&
        !saving.current
      ) {
        event.preventDefault();
        void callbacks.current.commit(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selected]);
  const size = chart.paneSize(0);
  const drawings = session.drawings
    .filter((d) => d.id !== removed)
    .map((d) => (working?.id === d.id ? working : d));
  if (working && !drawings.some((d) => d.id === working.id))
    drawings.push(working);
  const active = drawings.find((d) => d.id === selected);
  const startDrag = (
    event: React.PointerEvent,
    drawing: Drawing,
    handle: number | BoxHandle | null,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    select(drawing.id);
    latest.current.onInteract?.();
    if (drawing.locked || !onChange || saving.current) return;
    const rect = overlay.current!.getBoundingClientRect();
    const start = pointAt(event.clientX - rect.left, event.clientY - rect.top);
    if (!start) return;
    drag.current = {
      initial: structuredClone(drawing),
      start,
      handle,
      pointer: event.pointerId,
      changed: false,
    };
    edit(drawing);
    overlay.current!.setPointerCapture(event.pointerId);
  };
  const patch = (fields: Partial<Drawing>) => {
    if (active) void commit({ ...active, ...fields });
  };
  const shape = (drawing: Drawing, temporary = false) => {
    if (
      drawing.kind === "fibo" &&
      drawing.fibo &&
      !drawing.fibo.timeframes.includes(
        session.config.timeframe || session.dataset.timeframe,
      )
    )
      return null;
    const points = drawing.points.map(project);
    if (points.some((p) => !p)) return null;
    const [a, b] = points as Pixel[],
      color = drawing.color || "#d6b86c",
      width = drawing.line_width || 2,
      dash =
        drawing.line_style === "dashed"
          ? "8 5"
          : drawing.line_style === "dotted"
            ? "2 5"
            : undefined;
    const lines =
      drawing.kind === "horizontal"
        ? [{ x1: 0, x2: size.width, y1: a.y, y2: a.y }]
        : drawing.kind === "trend"
          ? [{ x1: a.x, x2: b.x, y1: a.y, y2: b.y }]
          : [];
    const handles: {
      point: Pixel;
      handle: number | BoxHandle;
      cursor: string;
    }[] =
      drawing.kind === "zone" && !temporary
        ? (() => {
            const left = Math.min(a.x, b.x),
              right = Math.max(a.x, b.x),
              top = Math.min(a.y, b.y),
              bottom = Math.max(a.y, b.y);
            const x = (left + right) / 2,
              y = (top + bottom) / 2;
            return [
              {
                point: { x: left, y: top },
                handle: "nw",
                cursor: "nwse-resize",
              },
              { point: { x, y: top }, handle: "n", cursor: "ns-resize" },
              {
                point: { x: right, y: top },
                handle: "ne",
                cursor: "nesw-resize",
              },
              { point: { x: right, y }, handle: "e", cursor: "ew-resize" },
              {
                point: { x: right, y: bottom },
                handle: "se",
                cursor: "nwse-resize",
              },
              { point: { x, y: bottom }, handle: "s", cursor: "ns-resize" },
              {
                point: { x: left, y: bottom },
                handle: "sw",
                cursor: "nesw-resize",
              },
              { point: { x: left, y }, handle: "w", cursor: "ew-resize" },
            ];
          })()
        : (points as Pixel[]).map((point, handle) => ({
            point,
            handle,
            cursor: "grab",
          }));
    return (
      <g
        key={drawing.id}
        data-testid={temporary ? "drawing-preview" : `drawing-${drawing.id}`}
        data-kind={drawing.kind}
        data-color={color}
        data-locked={String(!!drawing.locked)}
        role={temporary ? undefined : "button"}
        aria-label={temporary ? undefined : "เลือก " + drawing.label}
        tabIndex={temporary ? undefined : 0}
        className="drawing-shape"
        style={{ opacity: temporary ? 0.75 : 1 }}
        onPointerDown={
          temporary ? undefined : (e) => startDrag(e, drawing, null)
        }
        onContextMenu={
          temporary
            ? undefined
            : (e) => {
                e.preventDefault();
                e.stopPropagation();
                select(drawing.id);
                latest.current.onInteract?.();
              }
        }
        onDoubleClick={
          temporary
            ? undefined
            : (e) => {
                e.preventDefault();
                e.stopPropagation();
                select(drawing.id);
                setSettings(true);
                latest.current.onInteract?.();
              }
        }
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            select(drawing.id);
            latest.current.onInteract?.();
          }
        }}
      >
        {lines.map((line, i) => (
          <g key={i}>
            <line
              {...line}
              stroke={color}
              strokeWidth={width}
              strokeDasharray={dash}
              pointerEvents="none"
            />
            {!temporary && (
              <line
                {...line}
                stroke="transparent"
                strokeWidth={18}
                style={{
                  pointerEvents: tool ? "none" : "stroke",
                  cursor: drawing.locked ? "pointer" : "move",
                  touchAction: "none",
                }}
              />
            )}
          </g>
        ))}
        {drawing.kind === "fibo" && (
          <FiboShape
            drawing={drawing}
            a={a}
            b={b}
            width={size.width}
            priceCoordinate={(price) => series.priceToCoordinate(price)}
            temporary={temporary}
            interactive={!tool}
          />
        )}
        {drawing.kind === "zone" && (
          <rect
            x={Math.min(a.x, b.x)}
            y={Math.min(a.y, b.y)}
            width={Math.max(3, Math.abs(b.x - a.x))}
            height={Math.max(3, Math.abs(b.y - a.y))}
            fill={color + "22"}
            stroke={color}
            strokeWidth={width}
            strokeDasharray={dash}
            style={{
              pointerEvents: temporary || tool ? "none" : "all",
              cursor: drawing.locked ? "pointer" : "move",
              touchAction: "none",
            }}
          />
        )}
        {!(drawing.kind === "fibo" && drawing.fibo) && (
          <text
            x={Math.max(5, Math.min(size.width - 80, a.x + 8))}
            y={Math.max(15, a.y - 9)}
            fill={color}
            fontSize={11}
            pointerEvents="none"
          >
            {drawing.label}
          </text>
        )}
        {(temporary || selected === drawing.id) &&
          handles.map(({ point: p, handle, cursor }) => (
            <g key={handle}>
              <circle
                data-testid={temporary ? "drawing-anchor" : undefined}
                cx={p!.x}
                cy={p!.y}
                r={6}
                fill="#111820"
                stroke="#79aef8"
                strokeWidth={2}
                pointerEvents="none"
              />
              {!temporary && (
                <circle
                  data-testid={`drawing-handle-${handle}`}
                  cx={p!.x}
                  cy={p!.y}
                  r={15}
                  fill="transparent"
                  style={{
                    pointerEvents: tool || drawing.locked ? "none" : "all",
                    cursor,
                    touchAction: "none",
                  }}
                  onPointerDown={(e) => startDrag(e, drawing, handle)}
                />
              )}
            </g>
          ))}
      </g>
    );
  };
  return (
    <>
      <svg
        ref={overlay}
        className="drawing-layer replay-zone-overlay"
        data-testid="drawing-layer"
        width={size.width}
        height={size.height}
        style={{ width: size.width, height: size.height }}
        aria-label="ภาพวาดบนกราฟ"
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || event.pointerId !== current.pointer) return;
          const rect = event.currentTarget.getBoundingClientRect(),
            point = pointAt(
              event.clientX - rect.left,
              event.clientY - rect.top,
            );
          if (!point) return;
          const next = structuredClone(current.initial);
          if (typeof current.handle === "string") {
            next.points = resizeBox(
              current.initial.points,
              current.handle,
              point,
            );
          } else if (current.handle !== null) {
            if (
              next.kind === "trend" &&
              next.points.some(
                (p, i) => i !== current.handle && p.time === point.time,
              )
            )
              return;
            next.points[current.handle] = point;
          } else {
            next.points = translatedPoints(
              current.initial.points,
              current.start,
              point,
              latest.current.session.bars,
              interval,
            );
          }
          if (
            next.points.some(
              (p) => p.price <= 0 || p.time < 0 || p.time > 4102444800,
            )
          )
            return;
          current.changed =
            JSON.stringify(next.points) !==
            JSON.stringify(current.initial.points);
          edit(next);
        }}
        onPointerUp={(event) => {
          const current = drag.current;
          if (!current || event.pointerId !== current.pointer) return;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          if (current.changed && workingRef.current)
            void commit(workingRef.current);
          else edit(null);
        }}
        onPointerCancel={() => {
          drag.current = null;
          edit(null);
        }}
      >
        {drawings.map((d) => shape(d))}
        {preview && shape(preview, true)}
      </svg>
      {active && onChange && (
        <m.div
          className="drawing-toolbar"
          role="toolbar"
          aria-label="จัดการภาพวาด"
          initial={{ opacity: 0, y: -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <details className="drawing-colors">
            <summary aria-label="สีภาพวาด" title="สี">
              <Palette size={18} />
            </summary>
            <div>
              {colors.map((color) => (
                <button
                  key={color}
                  aria-label={"สี " + color}
                  disabled={busy}
                  style={{ background: color }}
                  onClick={(e) => {
                    patch(
                      active.kind === "fibo"
                        ? {
                            color,
                            fibo: {
                              ...settingsForFibo(active),
                              single_color: true,
                              single_color_value: color,
                            },
                          }
                        : { color },
                    );
                    e.currentTarget.closest("details")?.removeAttribute("open");
                  }}
                />
              ))}
            </div>
          </details>
          <select
            aria-label="ความหนาภาพวาด"
            value={active.line_width || 2}
            disabled={busy}
            onChange={(e) => patch({ line_width: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} px
              </option>
            ))}
          </select>
          <select
            aria-label="รูปแบบเส้นภาพวาด"
            value={active.line_style || "solid"}
            disabled={busy}
            onChange={(e) =>
              patch({ line_style: e.target.value as Drawing["line_style"] })
            }
          >
            <option value="solid">เส้นทึบ</option>
            <option value="dashed">เส้นประ</option>
            <option value="dotted">จุด</option>
          </select>
          <details className="drawing-rename">
            <summary aria-label="ชื่อภาพวาด" title="ชื่อ">
              <Pencil size={18} />
            </summary>
            <input
              key={active.id + active.label}
              defaultValue={active.label}
              maxLength={60}
              aria-label="แก้ชื่อภาพวาด"
              disabled={busy}
              onBlur={(e) => {
                if (e.target.value !== active.label)
                  patch({ label: e.target.value });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </details>
          <button
            aria-label="รายละเอียดภาพวาด"
            title="ตั้งค่าภาพวาด"
            disabled={busy}
            onClick={() => setSettings(true)}
          >
            <Settings2 size={18} />
          </button>
          <button
            aria-label="ทำสำเนาภาพวาด"
            title="ทำสำเนา"
            disabled={busy || session.drawings.length >= 100}
            onClick={() =>
              void commit(
                {
                  ...structuredClone(active),
                  id: crypto.randomUUID(),
                  locked: false,
                  points: active.points.map((p) => ({
                    ...p,
                    time: p.time + interval,
                  })),
                },
                true,
              )
            }
          >
            <Copy size={18} />
          </button>
          <button
            aria-label={active.locked ? "ปลดล็อกภาพวาด" : "ล็อกภาพวาด"}
            title={active.locked ? "ปลดล็อก" : "ล็อก"}
            disabled={busy}
            onClick={() => patch({ locked: !active.locked })}
          >
            {active.locked ? (
              <LockKeyhole size={18} />
            ) : (
              <UnlockKeyhole size={18} />
            )}
          </button>
          <button
            aria-label="ลบภาพวาดที่เลือก"
            title="ลบ · Delete"
            disabled={busy}
            onClick={() => void commit(null)}
          >
            <Trash2 size={18} />
          </button>
          <button
            aria-label="ปิดแถบภาพวาด"
            title="ปิด · Esc"
            onClick={() => select(null)}
          >
            <X size={16} />
          </button>
          {busy && (
            <span
              className="drawing-saving"
              role="status"
              aria-label="กำลังบันทึกภาพวาด"
            />
          )}
        </m.div>
      )}
      {tool && (
        <div className="drawing-hint">
          {hint ||
            (tool === "horizontal"
              ? "แตะราคาเพื่อวางเส้น · Esc ยกเลิก"
              : "แตะจุดแรก แล้วเลื่อนไปจุดปลาย")}{" "}
          · วางในพื้นที่ว่างได้
        </div>
      )}
      {settings && active?.kind === "fibo" && (
        <FiboSettingsModal
          key={active.id}
          drawing={active}
          busy={busy}
          close={() => setSettings(false)}
          save={(drawing) => commit(drawing)}
        />
      )}
      {settings && active && active.kind !== "fibo" && (
        <Modal
          title="รายละเอียดภาพวาด"
          close={() => {
            if (!saving.current) setSettings(false);
          }}
        >
          <form
            key={active.id}
            className="drawing-coordinate-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const fields = new FormData(event.currentTarget);
              const points = active.points.map((_, i) => ({
                time: Math.round(
                  new Date(`${String(fields.get(`time-${i}`))}Z`).getTime() /
                    1000,
                ),
                price: Number(fields.get(`price-${i}`)),
              }));
              const ok = await commit({
                ...active,
                label: String(fields.get("label") || ""),
                points,
              });
              if (ok) setSettings(false);
            }}
          >
            <label>
              ชื่อ
              <input name="label" defaultValue={active.label} maxLength={60} />
            </label>
            {active.points.map((p, i) => (
              <div className="drawing-coordinate-row" key={i}>
                <label>
                  เวลา จุด {i + 1} (UTC)
                  <input
                    name={`time-${i}`}
                    type="datetime-local"
                    min="1970-01-01T00:00:00"
                    max="2100-01-01T00:00:00"
                    step={1}
                    required
                    defaultValue={new Date(p.time * 1000)
                      .toISOString()
                      .slice(0, 19)}
                  />
                </label>
                <label>
                  ราคา จุด {i + 1}
                  <input
                    name={`price-${i}`}
                    type="number"
                    min={0.00000001}
                    step="any"
                    required
                    defaultValue={p.price}
                  />
                </label>
              </div>
            ))}
            <p className="muted">
              พิกัดภาพวาดแก้ได้อิสระ · เวลา Replay และผลเทรดยังคงเดิม
            </p>
            <button className="btn primary" type="submit" disabled={busy}>
              บันทึกภาพวาด
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
