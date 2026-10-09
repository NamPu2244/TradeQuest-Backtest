"use client";
import { useEffect, useRef, useState } from "react";
import {
  Code2,
  X,
  Save,
  Play,
  Plus,
  FileUp,
  Download,
  Trash2,
  Settings2,
} from "lucide-react";
import { api } from "../types";
import PineInputs from "./PineInputs";
import { PineSandbox, pineRequest, type PineResult } from "./pine-runtime";
import type { Session, PineScript, PineIndicator } from "./types";
const samples = {
  EMA: `//@version=6
indicator("My EMA", overlay=true)
length = input.int(20, "Period", minval=1, maxval=500)
plot(ta.ema(close, length), "EMA", color=color.orange, linewidth=2)
`,
  MACD: `//@version=6
indicator("My MACD", overlay=false)
fast = input.int(9, "Fast", minval=1)
slow = input.int(4, "Slow", minval=1)
signal = input.int(9, "Signal", minval=1)
[macdLine, signalLine, histogram] = ta.macd(close, fast, slow, signal)
plot(macdLine, "MACD", color=color.blue)
plot(signalLine, "Signal", color=color.orange)
plot(histogram, "Histogram", color=histogram >= 0 ? color.teal : color.red, style=plot.style_histogram)
hline(0, "Zero", color=color.gray)
`,
};
export default function PineEditor({
  session,
  close,
  apply,
}: {
  session: Session;
  close: () => void;
  apply: (i: PineIndicator) => Promise<boolean>;
}) {
  const [catalog, setCatalog] = useState<PineScript[]>([]),
    [selected, setSelected] = useState<PineScript | null>(null);
  const [name, setName] = useState("My EMA"),
    [source, setSource] = useState(samples.EMA),
    [inputs, setInputs] = useState<Record<string, number | boolean | string>>(
      {},
    );
  const [target, setTarget] = useState<string | null>(null),
    [version, setVersion] = useState(0),
    [result, setResult] = useState<PineResult | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [inputDialog, setInputDialog] = useState(false);
  const sandbox = useRef<PineSandbox | null>(null),
    alive = useRef(true),
    upload = useRef<HTMLInputElement>(null);
  const current = useRef(session);
  current.current = session;
  useEffect(() => {
    alive.current = true;
    void api<PineScript[]>("replay/pine-scripts")
      .then(setCatalog)
      .catch((e) => setError(e.message));
    return () => {
      alive.current = false;
      sandbox.current?.dispose();
      sandbox.current = null;
    };
  }, []);
  const load = (s: PineScript, v = s.latest_version) => {
    const snapshot = s.versions.find((x) => x.version === v)!;
    setSelected(s);
    setName(snapshot.name);
    setSource(snapshot.source);
    setVersion(v);
    setInputs({});
    setResult(null);
    setError("");
    setNotice("");
    setTarget(null);
  };
  const fresh = (sample: keyof typeof samples) => {
    setSelected(null);
    setName("My " + sample);
    setSource(samples[sample]);
    setInputs({});
    setResult(null);
    setTarget(null);
    setVersion(0);
    setError("");
    setNotice("");
  };
  const evaluate = async () => {
    if (!sandbox.current) sandbox.current = new PineSandbox();
    try {
      const replies = await sandbox.current.run(
        pineRequest(current.current, [{ id: "preview", source, inputs }]),
      );
      if (replies[0].error) throw Error(replies[0].error);
      const r = replies[0].result!;
      if (alive.current) {
        setResult(r);
        setNotice(
          `รันผ่าน · ${r.plots.length} plots · ${r.drawings.length} วัตถุ · ${current.current.bars.length} แท่งที่เปิดเผย`,
        );
      }
      return r;
    } catch (e) {
      sandbox.current.dispose();
      sandbox.current = null;
      throw e;
    }
  };
  const perform = async (action: "run" | "save" | "add") => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await evaluate();
      if (!alive.current) return;
      if (action === "run") return;
      const snapshot = selected?.versions.find((v) => v.version === version);
      let saved = selected;
      if (
        action === "save" ||
        !snapshot ||
        snapshot.source !== source ||
        snapshot.name !== name.trim()
      ) {
        saved = await api<PineScript>(
          "replay/pine-scripts" + (selected ? "/" + selected.id : ""),
          {
            method: selected ? "PUT" : "POST",
            body: JSON.stringify({
              name,
              source,
              ...(selected ? { base_version: selected.latest_version } : {}),
            }),
          },
        );
        if (alive.current) {
          setSelected(saved);
          setVersion(saved.latest_version);
          setCatalog((c) => [saved!, ...c.filter((x) => x.id !== saved!.id)]);
          setNotice("บันทึกแล้ว · v" + saved.latest_version);
        }
      }
      if (action === "add" && alive.current) {
        const v = saved!.versions.find(
          (v) =>
            v.version ===
            (saved === selected ? version : saved!.latest_version),
        )!;
        const i: PineIndicator = {
          id: target || crypto.randomUUID(),
          kind: "PINE",
          script_id: saved!.id,
          script_version: v.version,
          name: v.name,
          source: v.source,
          source_hash: v.source_hash,
          runtime_version: v.runtime_version,
          inputs,
        };
        if (await apply(i)) {
          setTarget(i.id);
          setNotice("นำขึ้นกราฟแล้ว · " + v.name + " v" + v.version);
        } else throw Error("นำขึ้นกราฟไม่ได้ กรุณาลองใหม่");
      }
    } catch (e) {
      if (alive.current) {
        setResult(null);
        setError((e as Error).message);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 160000) {
      setError("ไฟล์ใหญ่เกินขนาดที่รองรับ");
      return;
    }
    const code = await file.text();
    if (code.length > 40000) {
      setError("โค้ดยาวเกิน 40,000 ตัวอักษร");
      return;
    }
    fresh("EMA");
    setName(file.name.replace(/\.pine$/i, ""));
    setSource(code);
  };
  return (
    <section
      className="pine-editor"
      aria-label="Pine Editor"
      data-testid="pine-editor"
    >
      <header>
        <strong>
          <Code2 size={16} /> Pine Editor <small>v5 / v6 · ทดลอง</small>
        </strong>
        <button
          className="btn ghost small"
          aria-label="ปิด Pine Editor"
          onClick={close}
        >
          <X size={18} />
        </button>
      </header>
      <div className="pine-actions">
        <select
          aria-label="คลัง Pine ของฉัน"
          disabled={busy}
          value={selected?.id || ""}
          onChange={(e) => {
            const s = catalog.find((x) => x.id === e.target.value);
            if (s) load(s);
            else fresh("EMA");
          }}
        >
          <option value="">สคริปต์ใหม่</option>
          {catalog
            .filter((x) => !x.archived)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.versions.at(-1)!.name} · v{x.latest_version}
              </option>
            ))}
        </select>
        {selected && (
          <select
            aria-label="เวอร์ชัน Pine"
            value={version}
            disabled={busy}
            onChange={(e) => load(selected, Number(e.target.value))}
          >
            {selected.versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}
              </option>
            ))}
          </select>
        )}
        <input
          aria-label="ชื่อ Pine Indicator"
          maxLength={100}
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="btn ghost small"
          disabled={busy}
          onClick={() => fresh("EMA")}
        >
          ใหม่ EMA
        </button>
        <button
          className="btn ghost small"
          disabled={busy}
          onClick={() => fresh("MACD")}
        >
          ตัวอย่าง MACD
        </button>
        <button
          className="btn ghost small"
          disabled={busy}
          onClick={() => upload.current?.click()}
        >
          <FileUp size={14} /> .pine
        </button>
        <input
          ref={upload}
          type="file"
          accept=".pine,.txt"
          hidden
          onChange={(e) => {
            void importFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button
          className="btn ghost small"
          disabled={busy}
          aria-label="ส่งออก Pine"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([source], { type: "text/plain;charset=utf-8" }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = (name.trim() || "indicator") + ".pine";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          <Download size={14} />
        </button>
      </div>
      <div className="pine-code">
        <div aria-hidden="true">
          {source.split("\n").map((_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        <textarea
          aria-label="โค้ด Pine v5 / v6"
          spellCheck={false}

          disabled={busy}
          value={source}
          onScroll={(e) => {
            const gutter = e.currentTarget.previousElementSibling;
            if (gutter) gutter.scrollTop = e.currentTarget.scrollTop;
          }}
          onChange={(e) => {
            setSource(e.target.value);
            setResult(null);
            setNotice("");
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void perform("run");
            }
            if (e.key === "Tab") {
              e.preventDefault();
              const t = e.currentTarget,
                a = t.selectionStart,
                b = t.selectionEnd;
              setSource(source.slice(0, a) + "    " + source.slice(b));
              requestAnimationFrame(() => {
                t.selectionStart = t.selectionEnd = a + 4;
              });
            }
          }}
        />
      </div>
      <footer>
        <button
          className="btn ghost small"
          disabled={busy}
          onClick={() => void perform("run")}
        >
          <Play size={14} /> {busy ? "กำลังคำนวณ…" : "ตรวจและรัน"}
        </button>
        <button
          className="btn ghost small"
          disabled={busy || !name.trim()}
          onClick={() => void perform("save")}
        >
          <Save size={14} /> บันทึกเวอร์ชัน
        </button>
        <button
          className="btn primary small"
          disabled={busy || !name.trim()}
          onClick={() => void perform("add")}
        >
          <Plus size={14} /> {target ? "อัปเดตบนกราฟ" : "นำขึ้นกราฟ"}
        </button>
        <button
          className="btn ghost small"
          disabled={busy || !result?.inputs.length}
          onClick={() => setInputDialog(true)}
        >
          <Settings2 size={14} /> Inputs
        </button>
        {selected && (
          <button
            className="btn ghost small"
            disabled={busy}
            aria-label="ลบ Pine จากคลัง"
            onClick={async () => {
              setBusy(true);
              try {
                await api(
                  "replay/pine-scripts/" +
                    selected.id +
                    "?base_version=" +
                    selected.latest_version,
                  { method: "DELETE" },
                );
                setCatalog((c) => c.filter((x) => x.id !== selected.id));
                fresh("EMA");
                setNotice("ลบจากคลังแล้ว เวอร์ชันในรอบฝึกเดิมยังคงอยู่");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Trash2 size={14} />
          </button>
        )}
      </footer>
      {error && (
        <p role="alert" className="pine-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="pine-notice">
          {notice}
        </p>
      )}
      <p className="pine-hint">
        รองรับ Pine v5/v6: plot, histogram, hline
        และกล่อง/เส้น/ป้าย/สีพื้นหลังบนกราฟหลัก · ใช้เฉพาะ 2,000 แท่งที่ Replay
        เปิดเผย · PineTS 0.11.0 (ยังไม่เทียบเท่า TradingView) · request.*,
        strategy, table และ fill ยังไม่รองรับ
      </p>
      {!!session.indicators.filter((i) => i.kind === "PINE").length && (
        <div className="pine-active">
          <small>บนกราฟ</small>
          {session.indicators
            .filter((i): i is PineIndicator => i.kind === "PINE")
            .map((i) => (
              <button
                className="btn ghost small"
                key={i.id}
                disabled={busy}
                onClick={() => {
                  const found = catalog.find((x) => x.id === i.script_id);
                  if (found) load(found, i.script_version);
                  else {
                    setName(i.name);
                    setSource(i.source);
                    setSelected(null);
                  }
                  setTarget(i.id);
                  setInputs(i.inputs);
                  setNotice("กำลังแก้เวอร์ชันที่ใช้บนกราฟ");
                }}
              >
                {i.name} · v{i.script_version}
              </button>
            ))}
        </div>
      )}
      {inputDialog && result && (
        <PineInputs
          title={result.settingsTitle || result.title}
          metadata={result.inputs}
          values={inputs}
          close={() => setInputDialog(false)}
          apply={(next) => {
            setInputs(next);
            setInputDialog(false);
            setNotice("ปรับ input แล้ว กดนำขึ้นกราฟเพื่อใช้ค่าใหม่");
          }}
        />
      )}
    </section>
  );
}
