"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Play, History } from "lucide-react";
import { api, num } from "../types";
import { ChartLoading } from "../MotionUI";
import type { Dataset, Session, SessionSummary } from "./types";
import BacktestWorkspace from "./BacktestWorkspace";
import { timeLabel } from "./backtest-utils";
export default function Backtest() {
  const [datasets, setDatasets] = useState<Dataset[]>([]),
    [profiles, setProfiles] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<Session | null>(null),
    [tab, setTab] = useState<"home" | "create" | "load">("home");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [initialLoading, setInitialLoading] = useState(true);
  const busyRef = useRef(false);
  const [name, setName] = useState(""),
    [capital, setCapital] = useState("1000"),
    [currency, setCurrency] = useState("USD"),
    [target, setTarget] = useState("20"),
    [goal, setGoal] = useState("");
  const [symbol, setSymbol] = useState(""),
    [dataset, setDataset] = useState(""),
    [pointValue, setPointValue] = useState("1"),
    [spread, setSpread] = useState("0"),
    [fee, setFee] = useState("0");
  const [file, setFile] = useState<File | null>(null),
    [importSymbol, setImportSymbol] = useState("BTCUSD"),
    [tf, setTf] = useState("M5"),
    [offset, setOffset] = useState("0");
  const load = useCallback(async () => {
    const [data, saved] = await Promise.all([
      api<Dataset[]>("replay/datasets"),
      api<SessionSummary[]>("replay/sessions"),
    ]);
    setDatasets(data);
    setProfiles(saved);
    setSymbol((old) => old || data[0]?.symbol || "");
    setDataset((old) => old || data[0]?.id || "");
  }, []);
  useEffect(() => {
    void load()
      .catch((e) => setError(String(e)))
      .finally(() => setInitialLoading(false));
  }, [load]);
  const work = async (task: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const selectDataset = (d: Dataset) => {
    setSymbol(d.symbol);
    setDataset(d.id);
  };
  const chosen = datasets.find((d) => d.id === dataset && d.symbol === symbol);
  const back = async () => {
    setSession(null);
    setTab("load");
    await load();
  };
  if (initialLoading) return <ChartLoading label="กำลังเปิดโปรไฟล์ Backtest" />;
  if (session)
    return (
      <BacktestWorkspace
        key={session.id}
        session={session}
        onSession={setSession}
        onBack={() => void work(back)}
        onCopy={() => {
          selectDataset(session.dataset);
          setName(session.name + " · ใหม่");
          setSession(null);
          setTab("create");
        }}
      />
    );
  return (
    <div className="replay-page backtest-library">
      {busy && (
        <div className="profile-loading">
          <ChartLoading label="กำลังเตรียมกราฟ" />
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <section className="backtest-welcome panel">
        <span className="eyebrow">YOUR PRACTICE SPACE</span>
        <h2>สร้างพื้นที่ฝึกของคุณ</h2>
        <p>
          วาง Position บนกราฟ บันทึกสิ่งที่คิด แล้วค่อย ๆ เรียนรู้จากแต่ละไม้
        </p>
        <div className="backtest-profile-actions">
          <button
            className={
              "backtest-action " + (tab === "create" ? "selected" : "")
            }
            onClick={() => setTab("create")}
          >
            <Plus />
            <strong>Create โปรไฟล์</strong>
            <small>เริ่มต้นด้วยเงินจำลองและเป้าหมายของคุณ</small>
          </button>
          <button
            className={"backtest-action " + (tab === "load" ? "selected" : "")}
            onClick={() => setTab("load")}
          >
            <History />
            <strong>Load โปรไฟล์</strong>
            <small>ฝึกต่อหรือย้อนทบทวนรอบที่บันทึกไว้</small>
          </button>
        </div>
      </section>
      {tab === "create" && (
        <section className="panel backtest-create">
          <h3>Create โปรไฟล์ Backtest</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!chosen) return;
              void work(async () => {
                const created = await api<Session>("replay/sessions", {
                  method: "POST",
                  body: JSON.stringify({
                    dataset_id: chosen.id,
                    name,
                    workspace: "backtest",
                    initial_balance: Number(capital),
                    currency,
                    target_trades: Number(target),
                    goal,
                    point_value: Number(pointValue),
                    spread: Number(spread),
                    commission_r: Number(fee),
                  }),
                });
                setSession(created);
              });
            }}
          >
            <label>
              ชื่อโปรไฟล์
              <input
                aria-label="ชื่อโปรไฟล์ Backtest"
                value={name}
                required
                maxLength={150}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="replay-fields three">
              <label>
                เงินเริ่มต้น
                <input
                  aria-label="เงินเริ่มต้นจำลอง"
                  type="number"
                  min="0.01"
                  max="1000000000000"
                  step="any"
                  required
                  value={capital}
                  onChange={(e) => setCapital(e.target.value)}
                />
              </label>
              <label>
                สกุลเงินจำลอง
                <select
                  aria-label="สกุลเงินจำลอง"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  <option>USD</option>
                  <option>USC</option>
                  <option>THB</option>
                </select>
              </label>
              <label>
                จำนวนไม้เป้าหมาย
                <input
                  aria-label="จำนวนครั้งที่จะเทรด"
                  type="number"
                  min="1"
                  max="100000"
                  step="1"
                  required
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </label>
            </div>
            <div className="replay-fields">
              <label>
                Symbol
                <select
                  aria-label="Symbol โปรไฟล์"
                  value={symbol}
                  required
                  onChange={(e) => {
                    setSymbol(e.target.value);
                    setDataset(
                      datasets.find((d) => d.symbol === e.target.value)?.id ||
                        "",
                    );
                  }}
                >
                  <option value="">เลือก Symbol</option>
                  {[...new Set(datasets.map((d) => d.symbol))].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                ชุดข้อมูล / Timeframe
                <select
                  aria-label="ชุดข้อมูล Backtest"
                  value={chosen?.id || ""}
                  required
                  onChange={(e) => setDataset(e.target.value)}
                >
                  <option value="">เลือกข้อมูลกราฟ</option>
                  {datasets
                    .filter((d) => d.symbol === symbol)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ·{" "}
                        {d.tick_count
                          ? d.tick_count.toLocaleString() + " ticks"
                          : d.timeframe + " · " + d.count + " แท่ง"}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            {chosen && (
              <small>
                {chosen.synthetic
                  ? "DEMO DATA · ราคาจำลอง"
                  : chosen.tick_count
                    ? "Tick จริง · " + chosen.provider
                    : "ราคาย้อนหลัง"}{" "}
                · {timeLabel(chosen.first_time)} → {timeLabel(chosen.last_time)}{" "}
                · วันที่แสดงตามเวลาเครื่อง · แกนกราฟ UTC
                {chosen.tick_count
                  ? " · เปลี่ยน TF ได้ · ใช้ Bid/Ask ของ " +
                    chosen.provider +
                    " ซึ่งอาจต่างจาก Exness"
                  : ""}
              </small>
            )}
            <label>
              เป้าหมายการฝึก
              <textarea
                aria-label="เป้าหมายการฝึก"
                required
                maxLength={2000}
                value={goal}
                placeholder="เช่น ฝึกรอจังหวะเข้า และจดอารมณ์ให้ครบ 20 ไม้"
                onChange={(e) => setGoal(e.target.value)}
              />
            </label>
            <label>
              มูลค่าต่อราคาขยับ 1 หน่วย ต่อ 1 Lot ({currency})
              <input
                aria-label="มูลค่าต่อหนึ่งหน่วยราคา"
                type="number"
                min="0.000001"
                max="1000000000"
                step="any"
                required
                value={pointValue}
                onChange={(e) => setPointValue(e.target.value)}
              />
            </label>
            <small>
              เช่น กำหนด 100: ราคาเคลื่อน 1 หน่วย ที่ 0.01 Lot = 1 {currency} ·
              ใช้ค่าตามสัญญาที่คุณต้องการฝึก
              สกุลเงินนี้ใช้กับทุกผลคำนวณในโปรไฟล์
            </small>
            <p className="backtest-random-hint" data-testid="random-start-hint">
              สุ่มช่วงกราฟใหม่ทุกครั้งที่สร้างโปรไฟล์ · Load เล่นต่อจากจุดเดิม
            </p>
            <details>
              <summary>ช่วงเวลาและต้นทุนจำลอง</summary>
              <div className="replay-fields">
                <label>
                  Spread (หน่วยราคา)
                  <input
                    aria-label="Spread Backtest"
                    type="number"
                    min="0"
                    max="100000"
                    step="any"
                    disabled={!!chosen?.tick_count}
                    value={chosen?.tick_count ? "0" : spread}
                    onChange={(e) => setSpread(e.target.value)}
                  />
                </label>
                <label>
                  Commission ต่อไม้ (R)
                  <input
                    aria-label="Commission Backtest"
                    type="number"
                    min="0"
                    max="5"
                    step="any"
                    value={fee}
                    onChange={(e) => setFee(e.target.value)}
                  />
                </label>
              </div>
              <small>
                ทุกโปรไฟล์ใหม่สุ่มจุดเริ่มต้นจากชุดข้อมูล
                พร้อมกราฟย้อนหลังให้อ่าน · ยังไม่จำลอง Margin
              </small>
            </details>
            <button
              className="btn primary"
              disabled={busy || !chosen || !name.trim() || !goal.trim()}
            >
              <Play size={16} />
              เริ่ม Backtest
            </button>
          </form>
        </section>
      )}
      {(tab === "load" || tab === "home") && (
        <section className="panel">
          <h3>โปรไฟล์ที่บันทึกไว้</h3>
          {!profiles.length ? (
            <p className="muted">ยังไม่มีโปรไฟล์ เริ่มด้วย Create โปรไฟล์</p>
          ) : (
            <div className="replay-session-list">
              {profiles.map((p) => (
                <button
                  key={p.id}
                  className="replay-session-card"
                  disabled={busy}
                  onClick={() =>
                    void work(async () =>
                      setSession(await api<Session>("replay/sessions/" + p.id)),
                    )
                  }
                >
                  <strong>{p.name}</strong>
                  <small>
                    {p.dataset.symbol} · {p.dataset.timeframe} ·{" "}
                    {p.status === "finished" ? "จบรอบแล้ว" : "ฝึกต่อได้"}
                    {p.dataset.synthetic ? " · DEMO DATA" : ""}
                  </small>
                  {p.config.initial_balance !== undefined && (
                    <small>
                      เริ่ม {num(p.config.initial_balance)} {p.config.currency}{" "}
                      · เป้าหมาย {p.config.target_trades} ไม้
                    </small>
                  )}
                  <span>{p.config.goal || "รอบฝึกที่บันทึกไว้ก่อนหน้า"}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
      <details className="panel backtest-data">
        <summary>เพิ่มข้อมูลกราฟสำหรับฝึก</summary>
        <p className="muted">นำเข้า CSV หรือโหลดชุดข้อมูล DEMO สำหรับฝึก</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!file) return;
            void work(async () => {
              const body = new FormData();
              body.set("file", file);
              body.set("name", file.name);
              body.set("symbol", importSymbol);
              body.set("timeframe", tf);
              body.set("utc_offset_minutes", offset);
              const d = await api<Dataset>("replay/datasets/import", {
                method: "POST",
                body,
              });
              await load();
              selectDataset(d);
              setTab("create");
            });
          }}
        >
          <div className="replay-fields three">
            <label>
              Symbol ใน CSV
              <input
                aria-label="Symbol CSV Backtest"
                value={importSymbol}
                required
                maxLength={40}
                onChange={(e) => setImportSymbol(e.target.value)}
              />
            </label>
            <label>
              Timeframe
              <select
                aria-label="Timeframe CSV Backtest"
                value={tf}
                onChange={(e) => setTf(e.target.value)}
              >
                {["M1", "M5", "M15", "H1", "H4", "D1"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              UTC offset (นาที)
              <input
                type="number"
                aria-label="UTC offset CSV Backtest"
                min="-840"
                max="840"
                required
                value={offset}
                onChange={(e) => setOffset(e.target.value)}
              />
            </label>
          </div>
          <label>
            ไฟล์ CSV
            <input
              aria-label="ไฟล์ CSV Backtest"
              type="file"
              accept=".csv,.tsv,.txt"
              required
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          <small>
            time,open,high,low,close,volume หรือ Export Bars จาก MT5 · 30–50,000
            แท่งปิด · ไม่เกิน 8 MB
          </small>
          <button className="btn ghost small" disabled={busy}>
            นำเข้าข้อมูล Backtest
          </button>
        </form>
        <button
          className="btn ghost small"
          disabled={busy}
          onClick={() =>
            void work(async () => {
              const d = await api<Dataset>("replay/datasets/demo", {
                method: "POST",
              });
              await load();
              selectDataset(d);
              setTab("create");
            })
          }
        >
          ลองเครื่องมือด้วย DEMO DATA
        </button>
      </details>
    </div>
  );
}
