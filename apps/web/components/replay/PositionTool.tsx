"use client";
import { useRef } from "react";
import type { PositionDraft, PositionGeometry } from "./types";
type Handle = "body" | "entry" | "sl" | "tp" | "left" | "right";
export default function PositionTool({
  draft,
  geometry,
  editable,
  toPrice,
  toTime,
  shiftTime,
  onChange,
  onSettings,
}: {
  draft: PositionDraft;
  geometry: PositionGeometry;
  editable: boolean;
  toPrice: (y: number) => number | null;
  toTime: (x: number) => number | null;
  shiftTime: (time: number, from: number, to: number) => number;
  onChange: (draft: PositionDraft) => void;
  onSettings: () => void;
}) {
  const drag = useRef<{
    field: Handle;
    initial: PositionDraft;
    startPrice: number;
    startTime: number;
    pointer: number;
  } | null>(null);
  const { left, right, entry, sl, tp, height } = geometry;
  const endTime = draft.end_time ?? toTime(right) ?? draft.time;
  const begin = (event: React.PointerEvent<SVGElement>, field: Handle) => {
    if (!editable || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const svg = event.currentTarget.ownerSVGElement as SVGSVGElement | null;
    if (!svg) return;
    const rect = svg.getBoundingClientRect(),
      price = toPrice(event.clientY - rect.top),
      time = toTime(event.clientX - rect.left);
    if (price === null || time === null) return;
    drag.current = {
      field,
      initial: { ...draft, end_time: endTime },
      startPrice: price,
      startTime: time,
      pointer: event.pointerId,
    };
    svg.setPointerCapture(event.pointerId);
  };
  const finish = (event: React.PointerEvent<SVGSVGElement>, cancel = false) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    drag.current = null;
    if (cancel) onChange(current.initial);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const settings = (event: React.MouseEvent) => {
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    onSettings();
  };
  const hit = {
    pointerEvents: editable ? ("all" as const) : ("none" as const),
    cursor: "move",
    touchAction: "none",
  };
  const rr =
    Math.abs(draft.tp - draft.entry) / Math.abs(draft.entry - draft.sl);
  return (
    <svg
      className="backtest-position-overlay"
      style={{ height, width: geometry.width, touchAction: "none" }}
      aria-label="กรอบ Position จำลอง"
      data-testid="position-overlay"
      data-entry={draft.entry}
      data-sl={draft.sl}
      data-tp={draft.tp}
      data-time={draft.time}
      data-end-time={endTime}
      onContextMenu={settings}
      onDoubleClick={settings}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointer !== event.pointerId) return;
        const rect = event.currentTarget.getBoundingClientRect(),
          price = toPrice(event.clientY - rect.top),
          time = toTime(event.clientX - rect.left);
        if (price === null || time === null || price <= 0) return;
        const next = { ...current.initial },
          field = current.field;
        if (field === "body" || field === "entry") {
          const delta = price - current.startPrice;
          next.entry += delta;
          next.sl += delta;
          next.tp += delta;
          if (field === "body") {
            next.time = shiftTime(
              current.initial.time,
              current.startTime,
              time,
            );
            next.end_time = shiftTime(
              current.initial.end_time!,
              current.startTime,
              time,
            );
          }
        } else if (field === "left")
          next.time = Math.min(time, next.end_time! - 1);
        else if (field === "right")
          next.end_time = Math.max(time, next.time + 1);
        else next[field] = price;
        if (
          Math.min(next.entry, next.sl, next.tp) <= 0 ||
          next.time < 0 ||
          next.end_time! > 4102444800
        )
          return;
        onChange(next);
      }}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
    >
      <rect
        data-testid="position-body-profit"
        x={left}
        y={Math.min(entry, tp)}
        width={right - left}
        height={Math.abs(tp - entry)}
        fill="#08998130"
        stroke="#089981"
        style={hit}
        onPointerDown={(e) => begin(e, "body")}
      />
      <rect
        data-testid="position-body-loss"
        x={left}
        y={Math.min(entry, sl)}
        width={right - left}
        height={Math.abs(sl - entry)}
        fill="#f2364530"
        stroke="#f23645"
        style={hit}
        onPointerDown={(e) => begin(e, "body")}
      />
      {(["tp", "entry", "sl"] as const).map((field) => {
        const y = geometry[field],
          color =
            field === "tp" ? "#089981" : field === "sl" ? "#f23645" : "#2962ff";
        return (
          <g key={field}>
            <line
              x1={left}
              x2={right}
              y1={y}
              y2={y}
              stroke={color}
              strokeWidth={1.5}
            />
            {editable && (
              <line
                x1={left}
                x2={right}
                y1={y}
                y2={y}
                stroke="transparent"
                strokeWidth={18}
                style={{ ...hit, cursor: "ns-resize" }}
                onPointerDown={(e) => begin(e, field)}
              />
            )}
            <text
              x={left + 12}
              y={y - 9}
              fill={color}
              fontSize={11}
              pointerEvents="none"
            >
              {field.toUpperCase()} {draft[field].toFixed(5)}
              {field === "entry" && Number.isFinite(rr)
                ? ` · R:R ${rr.toFixed(2)}`
                : ""}
            </text>
            {editable && (
              <>
                <circle
                  cx={left}
                  cy={y}
                  r={5}
                  fill="#131722"
                  stroke="#2962ff"
                  strokeWidth={2}
                />
                <circle
                  data-testid={`position-handle-${field}`}
                  aria-label={`ลาก ${field.toUpperCase()}`}
                  cx={left}
                  cy={y}
                  r={15}
                  fill="transparent"
                  style={{ ...hit, cursor: "ns-resize" }}
                  onPointerDown={(e) => begin(e, field)}
                />
              </>
            )}
          </g>
        );
      })}
      {editable && (
        <>
          {(["left", "right"] as const).map((field) => (
            <g key={field}>
              <circle
                cx={geometry[field]}
                cy={(entry + tp) / 2}
                r={5}
                fill="#131722"
                stroke="#2962ff"
                strokeWidth={2}
              />
              <circle
                data-testid={`position-handle-${field}`}
                aria-label="ปรับความกว้าง Position"
                cx={geometry[field]}
                cy={(entry + tp) / 2}
                r={15}
                fill="transparent"
                style={{ ...hit, cursor: "ew-resize" }}
                onPointerDown={(e) => begin(e, field)}
              />
            </g>
          ))}
          <rect
            data-testid="position-settings-target"
            x={left + 15}
            y={entry + 8}
            width={Math.max(20, right - left - 30)}
            height={20}
            fill="transparent"
            style={hit}
            onPointerDown={(e) => begin(e, "body")}
          />
        </>
      )}
    </svg>
  );
}
