"use client";
import { useState } from "react";
import Modal from "./Modal";
const palette = [
  "#f23645",
  "#ff5d00",
  "#ff9800",
  "#fbc02d",
  "#4caf50",
  "#089981",
  "#00bcd4",
  "#2962ff",
  "#2157f3",
  "#9c27b0",
  "#e91e63",
  "#787b86",
  "#ffffff",
  "#000000",
];
function parseColor(value: string) {
  let hex = value.replace(/^#/, "");
  if (/^[a-f0-9]{3,4}$/i.test(hex)) hex = [...hex].map((c) => c + c).join("");
  if (/^[a-f0-9]{6}([a-f0-9]{2})?$/i.test(hex))
    return {
      rgb: "#" + hex.slice(0, 6),
      alpha: hex.length === 8 ? parseInt(hex.slice(6), 16) : 255,
    };
  const rgb =
    /^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
      value,
    );
  if (rgb)
    return {
      rgb:
        "#" +
        rgb
          .slice(1, 4)
          .map((c) => Math.min(255, Number(c)).toString(16).padStart(2, "0"))
          .join(""),
      alpha: Math.round(Math.min(1, Number(rgb[4] ?? 1)) * 255),
    };
  return { rgb: "#2962ff", alpha: 255 };
}
function encodeColor(rgb: string, alpha: number) {
  return rgb.toUpperCase() + alpha.toString(16).padStart(2, "0").toUpperCase();
}
export default function ColorControl({
  value,
  label,
  change,
}: {
  value: string;
  label: string;
  change: (v: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(value);
  const color = parseColor(value),
    edited = parseColor(draft),
    transparency = Math.round(100 - (edited.alpha / 255) * 100);
  return (
    <>
      <button
        type="button"
        className="pine-color-swatch"
        aria-label={label}
        title={label.replace("Pine input ", "")}
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
      >
        <span
          style={{ backgroundColor: encodeColor(color.rgb, color.alpha) }}
        />
      </button>
      {open && (
        <Modal
          title={label.replace("Pine input ", "")}
          close={() => setOpen(false)}
          className="pine-color-modal"
        >
          <form
            className="pine-color-controls"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              change(draft);
              setOpen(false);
            }}
          >
            <div className="pine-color-palette">
              {palette.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={"เลือกสี " + c}
                  style={{ backgroundColor: c }}
                  onClick={() => setDraft(encodeColor(c, edited.alpha))}
                />
              ))}
            </div>
            <label>
              สีที่กำหนดเอง
              <input
                type="color"
                aria-label="สีที่กำหนดเอง"
                value={edited.rgb}
                onChange={(e) =>
                  setDraft(encodeColor(e.target.value, edited.alpha))
                }
              />
            </label>
            <div className="pine-color-preview">
              <span
                style={{
                  backgroundColor: encodeColor(edited.rgb, edited.alpha),
                }}
              />
            </div>
            <label>
              ความโปร่งใส
              <input
                type="range"
                aria-label="แถบความโปร่งใส"
                min={0}
                max={100}
                value={transparency}
                onChange={(e) =>
                  setDraft(
                    encodeColor(
                      edited.rgb,
                      Math.round(((100 - Number(e.target.value)) * 255) / 100),
                    ),
                  )
                }
              />
            </label>
            <label className="pine-color-percent">
              ความโปร่งใส (%)
              <input
                aria-label="ความโปร่งใส (%)"
                type="number"
                required
                min={0}
                max={100}
                value={transparency}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (e.target.value && n >= 0 && n <= 100)
                    setDraft(
                      encodeColor(
                        edited.rgb,
                        Math.round(((100 - n) * 255) / 100),
                      ),
                    );
                }}
              />
            </label>
            <div className="pine-color-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setOpen(false)}
              >
                ยกเลิกสี
              </button>
              <button type="submit" className="btn pine-settings-apply">
                ใช้สี
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
