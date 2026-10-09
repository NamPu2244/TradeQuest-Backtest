"use client";
import { useState } from "react";
import { HelpCircle } from "lucide-react";
import Modal from "../Modal";
import ColorControl from "../ColorControl";
import type { PineInput } from "./pine-runtime";
type Values = Record<string, number | boolean | string>;
type Row = { key: string; inline: boolean; fields: PineInput[] };
function groups(metadata: PineInput[]) {
  const result = new Map<string, Map<string, Row>>();
  for (const m of metadata) {
    const group = m.group || "";
    if (!result.has(group)) result.set(group, new Map());
    const rows = result.get(group)!;
    const key = m.inline ? "inline:" + m.inline : "field:" + m.id;
    if (!rows.has(key)) rows.set(key, { key, inline: !!m.inline, fields: [] });
    rows.get(key)!.fields.push(m);
  }
  return [...result].map(([name, rows]) => ({
    name,
    rows: [...rows.values()],
  }));
}
function caption(m: PineInput) {
  return m.title ?? m.name;
}
function context(row: Row, group: string) {
  return (
    row.fields.map(caption).find(Boolean) ||
    row.fields.find((m) => m.type === "string" && typeof m.defval === "string")
      ?.defval ||
    group ||
    "ตัวเลือก"
  );
}
export default function PineInputs({
  title,
  metadata,
  values,
  close,
  apply,
}: {
  title: string;
  metadata: PineInput[];
  values: Values;
  close: () => void;
  apply: (values: Values) => void;
}) {
  const [draft, setDraft] = useState<Values>(() => ({ ...values }));
  return (
    <Modal
      title={title}
      close={close}
      className="pine-settings-modal"
      closeLabel="ยกเลิกการตั้งค่า Pine"
    >
      <form
        className="pine-settings"
        onSubmit={(e) => {
          e.preventDefault();
          apply(draft);
        }}
      >
        <div className="pine-settings-tab">ข้อมูล</div>
        <div className="pine-input-groups">
          {groups(metadata).map((group) => (
            <section
              className="pine-input-group"
              key={group.name}
              aria-label={group.name || "ข้อมูลทั่วไป"}
            >
              {group.name && <h3>{group.name}</h3>}
              {group.rows.map((row) => (
                <div
                  className="pine-input-row"
                  key={row.key}
                  data-testid="pine-input-row"
                  data-inline={row.inline}
                >
                  {row.fields.map((m) => (
                    <InputControl
                      key={m.id}
                      meta={m}
                      context={String(context(row, group.name))}
                      value={draft[m.id] ?? m.defval}
                      change={(value) =>
                        setDraft((v) => ({ ...v, [m.id]: value }))
                      }
                    />
                  ))}
                  {row.fields.findLast((m) => m.tooltip)?.tooltip && (
                    <span
                      className="pine-input-help"
                      tabIndex={0}
                      role="img"
                      aria-label={
                        row.fields.findLast((m) => m.tooltip)!.tooltip
                      }
                      title={row.fields.findLast((m) => m.tooltip)!.tooltip}
                    >
                      <HelpCircle size={15} />
                    </span>
                  )}
                </div>
              ))}
            </section>
          ))}
        </div>
        <footer className="pine-settings-footer">
          <button
            type="button"
            className="btn ghost"
            onClick={() => setDraft({})}
          >
            คืนค่าเริ่มต้น
          </button>
          <div>
            <button type="button" className="btn ghost" onClick={close}>
              ยกเลิก
            </button>
            <button type="submit" className="btn pine-settings-apply">
              ตกลง
            </button>
          </div>
          <small>
            กดนำขึ้นกราฟเพื่อใช้ค่าที่ตั้ง · ช่วงเวลายึดตามเขตเวลาของสคริปต์
          </small>
        </footer>
      </form>
    </Modal>
  );
}
function InputControl({
  meta: m,
  value,
  change,
  context,
}: {
  meta: PineInput;
  value: number | boolean | string;
  change: (v: number | boolean | string) => void;
  context: string;
}) {
  const title = caption(m),
    id = "pine-control-" + m.id;
  const label =
    "Pine input " +
    (title ||
      ({ bool: "เปิด/ปิด ", color: "สี ", session: "ช่วงเวลา " }[m.type] ||
        "") + context);
  const options =
    m.options ||
    (m.type === "source"
      ? ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4"]
      : undefined);
  return (
    <div className={"pine-field pine-field-" + m.type} data-input-id={m.id}>
      {m.type === "bool" ? (
        <>
          <input
            id={id}
            type="checkbox"
            aria-label={label}
            checked={!!value}
            onChange={(e) => change(e.target.checked)}
          />
          {title && <label htmlFor={id}>{title}</label>}
        </>
      ) : (
        <>
          {title && <label htmlFor={id}>{title}</label>}
          {options ? (
            <select
              id={id}
              aria-label={label}
              value={String(value)}
              onChange={(e) =>
                change(
                  typeof m.defval === "number"
                    ? Number(e.target.value)
                    : e.target.value,
                )
              }
            >
              {options.map((v) => (
                <option key={String(v)} value={String(v)}>
                  {String(v)}
                </option>
              ))}
            </select>
          ) : m.type === "color" ? (
            <ColorControl value={String(value)} label={label} change={change} />
          ) : m.type === "session" ? (
            <SessionControl
              value={String(value)}
              label={label}
              change={change}
            />
          ) : (
            <input
              id={id}
              aria-label={label}
              required={["int", "float", "price", "time"].includes(m.type)}
              type={
                ["int", "float", "price", "time"].includes(m.type)
                  ? "number"
                  : "text"
              }
              value={String(value)}
              min={m.minval}
              max={m.maxval}
              step={m.step ?? (m.type === "int" ? 1 : "any")}
              onChange={(e) =>
                change(
                  ["int", "float", "price", "time"].includes(m.type) &&
                    e.target.value !== ""
                    ? Number(e.target.value)
                    : e.target.value,
                )
              }
            />
          )}
        </>
      )}
    </div>
  );
}
function SessionControl({
  value,
  label,
  change,
}: {
  value: string;
  label: string;
  change: (v: string) => void;
}) {
  const match = /^(\d{2})(\d{2})-(\d{2})(\d{2})(:[1-7]+)?$/.exec(
    value === "24x7" ? "0000-0000" : value,
  );
  if (
    !match ||
    [match[1], match[3]].some((v) => Number(v) > 23) ||
    [match[2], match[4]].some((v) => Number(v) > 59)
  )
    return (
      <input
        aria-label={label}
        value={value}
        required
        onChange={(e) => change(e.target.value)}
      />
    );
  const start = match[1] + ":" + match[2],
    end = match[3] + ":" + match[4];
  return (
    <div className="pine-session">
      <input
        type="time"
        aria-label={label + " เริ่ม"}
        value={start}
        required
        onChange={(e) => {
          if (e.target.value)
            change(
              e.target.value.replace(":", "") +
                "-" +
                end.replace(":", "") +
                (match[5] || ""),
            );
        }}
      />
      <span aria-hidden="true">—</span>
      <input
        type="time"
        aria-label={label + " สิ้นสุด"}
        value={end}
        required
        onChange={(e) => {
          if (e.target.value)
            change(
              start.replace(":", "") +
                "-" +
                e.target.value.replace(":", "") +
                (match[5] || ""),
            );
        }}
      />
    </div>
  );
}
