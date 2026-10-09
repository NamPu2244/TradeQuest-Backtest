"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import Modal from "../Modal";
import ColorControl from "../ColorControl";
import type { Drawing, FiboSettings } from "./types";
import { defaultFibo, fiboTimeframes, settingsForFibo } from "./fibo";
const horizontal = (
  <>
    <option value="left">ซ้าย</option>
    <option value="center">ตรงกลาง</option>
    <option value="right">ขวา</option>
  </>
);
const vertical = (
  <>
    <option value="top">ด้านบน</option>
    <option value="center">ตรงกลาง</option>
    <option value="bottom">ด้านล่าง</option>
  </>
);
const styles = (
  <>
    <option value="solid">เส้นทึบ</option>
    <option value="dashed">เส้นประ</option>
    <option value="dotted">จุด</option>
  </>
);
export default function FiboSettingsModal({
  drawing,
  busy,
  close,
  save,
}: {
  drawing: Drawing;
  busy: boolean;
  close: () => void;
  save: (drawing: Drawing) => Promise<boolean | undefined>;
}) {
  const [draft, setDraft] = useState(() => structuredClone(drawing));
  const [settings, setSettings] = useState(() => settingsForFibo(drawing));
  const [values, setValues] = useState(() =>
    settings.levels.map((level) => String(level.value)),
  );
  const [coordinates, setCoordinates] = useState(() =>
    drawing.points.map((p) => ({
      time: new Date(p.time * 1000).toISOString().slice(0, 19),
      price: String(p.price),
    })),
  );
  const [tab, setTab] = useState("style"),
    [error, setError] = useState("");
  const patch = (fields: Partial<FiboSettings>) =>
    setSettings((old) => ({ ...old, ...fields }));
  const levelPatch = (
    index: number,
    fields: Partial<FiboSettings["levels"][number]>,
  ) =>
    patch({
      levels: settings.levels.map((level, i) =>
        i === index ? { ...level, ...fields } : level,
      ),
    });
  const reset = (preset: string) => {
    if (!preset) return;
    const next =
      preset === "reference"
        ? defaultFibo()
        : settingsForFibo({ ...drawing, fibo: undefined });
    setSettings(next);
    setValues(next.levels.map((level) => String(level.value)));
    setError("");
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const levels = settings.levels.map((level, i) => ({
      ...level,
      value: Number(values[i]),
    }));
    if (
      levels.some(
        (level, i) =>
          !values[i].trim() ||
          !Number.isFinite(level.value) ||
          Math.abs(level.value) > 100,
      )
    ) {
      setTab("style");
      setError("ระดับต้องเป็นตัวเลขระหว่าง -100 ถึง 100");
      return;
    }
    const points = coordinates.map((p) => ({
      time: Math.round(new Date(p.time + "Z").getTime() / 1000),
      price: Number(p.price),
    }));
    if (
      points.some(
        (p, i) =>
          !coordinates[i].price.trim() ||
          !Number.isFinite(p.time) ||
          p.time < 0 ||
          p.time > 4102444800 ||
          !Number.isFinite(p.price) ||
          p.price <= 0,
      )
    ) {
      setTab("coordinates");
      setError("ระบุเวลา UTC ปี 1970–2100 และราคาที่มากกว่า 0 ทั้งสองจุด");
      return;
    }
    if (
      !Number.isInteger(settings.font_size) ||
      settings.font_size < 10 ||
      settings.font_size > 24
    ) {
      setTab("style");
      setError("ขนาดตัวอักษรต้องอยู่ระหว่าง 10–24");
      return;
    }
    if (await save({ ...draft, points, fibo: { ...settings, levels } }))
      close();
    else setError("บันทึกไม่ได้ กรุณาลองอีกครั้ง");
  };
  const check = (
    key:
      | "trend_line"
      | "background"
      | "reverse"
      | "single_color"
      | "show_prices"
      | "show_levels"
      | "show_text",
    label: string,
  ) => (
    <label className="fibo-check">
      <input
        type="checkbox"
        checked={settings[key]}
        onChange={(e) => patch({ [key]: e.target.checked })}
      />
      {label}
    </label>
  );
  return (
    <Modal
      title="Fib Retracement"
      close={() => {
        if (!busy) close();
      }}
      className="fibo-settings-modal"
    >
      <form className="fibo-settings" onSubmit={submit} noValidate>
        <div
          className="fibo-tabs"
          role="tablist"
          aria-label="ตั้งค่า Fibonacci"
        >
          {[
            ["style", "รูปแบบ"],
            ["coordinates", "พิกัดตำแหน่ง"],
            ["visibility", "การแสดงผล"],
          ].map(([id, label]) => (
            <button
              type="button"
              key={id}
              role="tab"
              id={`fibo-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`fibo-panel-${id}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <fieldset className="fibo-body" disabled={busy}>
          <div
            role="tabpanel"
            id="fibo-panel-style"
            aria-labelledby="fibo-tab-style"
            hidden={tab !== "style"}
          >
            <div className="fibo-option-row">
              {check("trend_line", "เส้นแนวโน้ม")}
              <ColorControl
                value={settings.trend_color}
                label="สีเส้นแนวโน้ม Fibo"
                change={(trend_color) => patch({ trend_color })}
              />
              <select
                aria-label="รูปแบบเส้นแนวโน้ม Fibo"
                value={settings.trend_style}
                onChange={(e) =>
                  patch({
                    trend_style: e.target.value as FiboSettings["trend_style"],
                  })
                }
              >
                {styles}
              </select>
            </div>
            <div className="fibo-option-row">
              <span>เส้นระดับ</span>
              <select
                aria-label="ความหนาเส้นระดับ Fibo"
                value={draft.line_width || 2}
                onChange={(e) =>
                  setDraft({ ...draft, line_width: Number(e.target.value) })
                }
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option value={n} key={n}>
                    {n} px
                  </option>
                ))}
              </select>
              <select
                aria-label="รูปแบบเส้นระดับ Fibo"
                value={draft.line_style || "solid"}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    line_style: e.target.value as Drawing["line_style"],
                  })
                }
              >
                {styles}
              </select>
            </div>
            <label className="fibo-option-row">
              <span>ยืดออก</span>
              <select
                aria-label="การยืดเส้น Fibo"
                value={settings.extend}
                onChange={(e) =>
                  patch({ extend: e.target.value as FiboSettings["extend"] })
                }
              >
                <option value="none">ไม่ยืด</option>
                <option value="right">ยืดเส้นไปทางขวา</option>
                <option value="left">ยืดเส้นไปทางซ้าย</option>
                <option value="both">ยืดเส้นทั้งสองด้าน</option>
              </select>
            </label>
            <div className="fibo-level-grid">
              {settings.levels.map((level, i) => (
                <div
                  className="fibo-level-row"
                  key={i}
                  data-testid={`fibo-setting-level-${i}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`เปิดระดับ Fibo ${i + 1}`}
                    checked={level.enabled}
                    onChange={(e) =>
                      levelPatch(i, { enabled: e.target.checked })
                    }
                  />
                  <input
                    aria-label={`ค่าระดับ Fibo ${i + 1}`}
                    type="number"
                    min={-100}
                    max={100}
                    step="any"
                    disabled={!level.enabled}
                    value={values[i]}
                    onChange={(e) =>
                      setValues(
                        values.map((v, j) => (j === i ? e.target.value : v)),
                      )
                    }
                  />
                  <ColorControl
                    value={level.color}
                    label={`สีระดับ Fibo ${i + 1}`}
                    change={(color) => levelPatch(i, { color })}
                  />
                  <button
                    className="fibo-remove-level"
                    type="button"
                    aria-label={`ลบระดับ Fibo ${i + 1}`}
                    disabled={settings.levels.length === 1}
                    onClick={() => {
                      patch({
                        levels: settings.levels.filter((_, j) => i !== j),
                      });
                      setValues(values.filter((_, j) => i !== j));
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              className="btn ghost small fibo-add-level"
              type="button"
              disabled={settings.levels.length >= 32}
              onClick={() => {
                patch({
                  levels: [
                    ...settings.levels,
                    { value: 0, enabled: true, color: "#2962ff" },
                  ],
                });
                setValues([...values, "0"]);
              }}
            >
              <Plus size={15} /> เพิ่มระดับ
            </button>
            <div className="fibo-option-row">
              {check("single_color", "ใช้สีเดียว")}
              <ColorControl
                value={settings.single_color_value}
                label="สีเดียว Fibo"
                change={(single_color_value) => patch({ single_color_value })}
              />
            </div>
            <div className="fibo-option-row">
              {check("background", "พื้นหลัง")}
              <input
                type="range"
                aria-label="ความทึบพื้นหลัง Fibo"
                min={0}
                max={100}
                value={settings.background_opacity}
                onChange={(e) =>
                  patch({ background_opacity: Number(e.target.value) })
                }
              />
              <output>{settings.background_opacity}%</output>
            </div>
            <div className="fibo-option-row">
              {check("reverse", "กลับสถานะ")}
            </div>
            <div className="fibo-option-row">
              {check("show_prices", "ราคา")}
            </div>
            <div className="fibo-option-row">
              {check("show_levels", "ระดับ")}
              <select
                aria-label="รูปแบบป้ายระดับ Fibo"
                value={settings.level_format}
                onChange={(e) =>
                  patch({
                    level_format: e.target
                      .value as FiboSettings["level_format"],
                  })
                }
              >
                <option value="value">มูลค่า</option>
                <option value="percent">เปอร์เซ็นต์</option>
              </select>
            </div>
            <div className="fibo-option-row">
              <span>ป้ายชื่อ</span>
              <select
                aria-label="ตำแหน่งป้ายระดับ Fibo"
                value={settings.label_position}
                onChange={(e) =>
                  patch({
                    label_position: e.target
                      .value as FiboSettings["label_position"],
                  })
                }
              >
                {horizontal}
              </select>
              <select
                aria-label="แนวตั้งป้ายระดับ Fibo"
                value={settings.label_vertical}
                onChange={(e) =>
                  patch({
                    label_vertical: e.target
                      .value as FiboSettings["label_vertical"],
                  })
                }
              >
                {vertical}
              </select>
            </div>
            <div className="fibo-option-row">
              {check("show_text", "ตัวอักษร")}
              <select
                aria-label="ตำแหน่งชื่อ Fibo"
                value={settings.text_position}
                onChange={(e) =>
                  patch({
                    text_position: e.target
                      .value as FiboSettings["text_position"],
                  })
                }
              >
                {horizontal}
              </select>
              <select
                aria-label="แนวตั้งชื่อ Fibo"
                value={settings.text_vertical}
                onChange={(e) =>
                  patch({
                    text_vertical: e.target
                      .value as FiboSettings["text_vertical"],
                  })
                }
              >
                {vertical}
              </select>
            </div>
            <label className="fibo-option-row">
              <span>ขนาดตัวอักษร</span>
              <input
                aria-label="ขนาดตัวอักษร Fibo"
                type="number"
                min={10}
                max={24}
                value={settings.font_size}
                onChange={(e) => patch({ font_size: Number(e.target.value) })}
              />
            </label>
          </div>
          <div
            role="tabpanel"
            id="fibo-panel-coordinates"
            aria-labelledby="fibo-tab-coordinates"
            hidden={tab !== "coordinates"}
            className="drawing-coordinate-form"
          >
            <label>
              ชื่อ
              <input
                aria-label="ชื่อ Fibo"
                maxLength={60}
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </label>
            {coordinates.map((p, i) => (
              <div className="drawing-coordinate-row" key={i}>
                <label>
                  เวลา จุด {i + 1} (UTC)
                  <input
                    type="datetime-local"
                    min="1970-01-01T00:00:00"
                    max="2100-01-01T00:00:00"
                    step={1}
                    value={p.time}
                    onChange={(e) =>
                      setCoordinates(
                        coordinates.map((p, j) =>
                          i === j ? { ...p, time: e.target.value } : p,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  ราคา จุด {i + 1}
                  <input
                    type="number"
                    min={0.00000001}
                    step="any"
                    value={p.price}
                    onChange={(e) =>
                      setCoordinates(
                        coordinates.map((p, j) =>
                          i === j ? { ...p, price: e.target.value } : p,
                        ),
                      )
                    }
                  />
                </label>
              </div>
            ))}
            <p className="muted">
              พิกัดเป็นเวลา UTC · ไม่เปลี่ยนเวลา Replay หรือผลเทรด
            </p>
          </div>
          <div
            role="tabpanel"
            id="fibo-panel-visibility"
            aria-labelledby="fibo-tab-visibility"
            hidden={tab !== "visibility"}
          >
            <p>แสดง Fibo ใน Timeframe ที่เลือก</p>
            <div className="fibo-timeframes">
              {fiboTimeframes.map((tf) => (
                <label className="fibo-check" key={tf}>
                  <input
                    type="checkbox"
                    checked={settings.timeframes.includes(tf)}
                    onChange={(e) =>
                      patch({
                        timeframes: e.target.checked
                          ? [...settings.timeframes, tf]
                          : settings.timeframes.filter((t) => t !== tf),
                      })
                    }
                  />
                  {tf}
                </label>
              ))}
            </div>
            <p className="muted">
              ซ่อนเฉพาะภาพวาด ค่าตั้งค่ายังคงบันทึกอยู่ในโปรไฟล์
            </p>
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="fibo-error">
            {error}
          </p>
        )}
        <footer className="fibo-footer">
          <select
            aria-label="เทมเพลต Fibo"
            disabled={busy}
            value=""
            onChange={(e) => reset(e.target.value)}
          >
            <option value="">เทมเพลต</option>
            <option value="reference">ระดับตามภาพตัวอย่าง</option>
            <option value="legacy">0 / 50 / 100</option>
          </select>
          <div>
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={close}
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="btn pine-settings-apply"
              disabled={busy}
            >
              {busy ? "กำลังบันทึก…" : "ตกลง"}
            </button>
          </div>
        </footer>
      </form>
    </Modal>
  );
}
