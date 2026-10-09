"use client";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import Modal from "../Modal";
import { num, signed } from "../types";
import type {
  BuiltinIndicator,
  Indicator,
  PracticeTrade,
  PositionDraft,
} from "./types";
import { indicatorName } from "./backtest-utils";
export function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal title={title} close={close}>
      {children}
    </Modal>
  );
}

export function PositionForm({
  draft,
  change,
  pointValue,
  currency,
  busy,
  reference,
  error,
  submit,
}: {
  draft: PositionDraft;
  change: (d: PositionDraft) => void;
  pointValue: number;
  currency: string;
  busy: boolean;
  reference: number;
  error: string;
  submit: () => Promise<void>;
}) {
  const valid =
    Number.isFinite(draft.entry + draft.sl + draft.tp + draft.lot) &&
    Math.min(draft.entry, draft.sl, draft.tp, draft.lot) > 0 &&
    (draft.side === "BUY"
      ? draft.sl < draft.entry && draft.entry < draft.tp
      : draft.tp < draft.entry && draft.entry < draft.sl);
  const risk = Math.abs(draft.entry - draft.sl) * draft.lot * pointValue,
    reward = Math.abs(draft.tp - draft.entry) * draft.lot * pointValue;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void submit();
      }}
    >
      <p>
        {draft.side === "BUY" ? "Long" : "Short"} · เปิดคำสั่งจำลองบนแท่งถัดไป
      </p>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <label>
        วิธีเข้า
        <select
          aria-label="วิธีเข้า Position"
          value={draft.order_type}
          disabled={busy}
          onChange={(e) =>
            change({
              ...draft,
              order_type: e.target.value as PositionDraft["order_type"],
              entry: e.target.value === "MARKET" ? reference : draft.entry,
            })
          }
        >
          <option value="MARKET">Market · Open แท่งถัดไป</option>
          <option value="LIMIT">Limit · รอเก็บราคาที่วางไว้</option>
          <option value="STOP">Stop · รอราคาผ่านจุดเข้า</option>
        </select>
      </label>
      <div className="replay-fields">
        <label>
          Entry
          <input
            aria-label="Entry Position"
            type="number"
            min="0.000001"
            step="any"
            required
            disabled={busy}
            value={draft.entry}
            onChange={(e) =>
              change({ ...draft, entry: Number(e.target.value) })
            }
          />
        </label>
        <label>
          ขนาด Lot
          <input
            aria-label="Lot Position"
            type="number"
            min="0.000001"
            max="100000"
            step="any"
            required
            disabled={busy}
            value={draft.lot}
            onChange={(e) => change({ ...draft, lot: Number(e.target.value) })}
          />
        </label>
        <label>
          Stop Loss
          <input
            aria-label="SL Position"
            type="number"
            min="0.000001"
            step="any"
            required
            disabled={busy}
            value={draft.sl}
            onChange={(e) => change({ ...draft, sl: Number(e.target.value) })}
          />
        </label>
        <label>
          Take Profit
          <input
            aria-label="TP Position"
            type="number"
            min="0.000001"
            step="any"
            required
            disabled={busy}
            value={draft.tp}
            onChange={(e) => change({ ...draft, tp: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="backtest-risk-preview">
        เสี่ยงประมาณ {num(risk)} {currency} · เป้ากำไร {num(reward)} {currency}{" "}
        · R:R 1:{risk > 0 ? num(reward / risk) : "—"}
      </div>
      {!valid && (
        <small>
          Long: SL &lt; Entry &lt; TP · Short: TP &lt; Entry &lt; SL
        </small>
      )}
      <small>
        Market เข้า Open แท่งถัดไป ราคาจริงในรอบฝึกอาจต่างจากกรอบที่วาง · หากแตะ
        TP และ SL ในแท่งเดียวกัน ใช้ SL ก่อน
      </small>
      <button className="btn primary" disabled={busy || !valid}>
        เปิด Position จำลอง
      </button>
    </form>
  );
}
export function IndicatorForm({
  indicators,
  busy,
  error,
  add,
  remove,
}: {
  indicators: Indicator[];
  busy: boolean;
  error: string;
  add: (i: Indicator) => Promise<void>;
  remove: (i: Indicator) => void;
}) {
  const [kind, setKind] = useState<BuiltinIndicator["kind"]>("EMA"),
    [period, setPeriod] = useState("20"),
    [fast, setFast] = useState("9"),
    [slow, setSlow] = useState("4"),
    [signal, setSignal] = useState("9");
  return (
    <>
      <div className="backtest-indicator-list">
        {!indicators.length && (
          <p className="muted">
            กราฟเริ่มต้นว่าง เลือกเพิ่มอินดิเคเตอร์ที่คุณต้องการ
          </p>
        )}
        {indicators.map((i) => (
          <div key={i.id}>
            <strong>{indicatorName(i)}</strong>
            <button
              className="btn ghost small"
              disabled={busy}
              aria-label={"ลบ " + indicatorName(i)}
              onClick={() => remove(i)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      {error && (
        <div role="alert" className="error-banner">
          {error}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add({
            id: crypto.randomUUID(),
            kind,
            period: Number(period),
            fast: Number(fast),
            slow: Number(slow),
            signal: Number(signal),
          });
        }}
      >
        <label>
          เลือกอินดิเคเตอร์
          <select
            aria-label="อินดิเคเตอร์ Backtest"
            value={kind}
            disabled={busy}
            onChange={(e) =>
              setKind(e.target.value as BuiltinIndicator["kind"])
            }
          >
            {["EMA", "SMA", "RSI", "MACD", "VOLUME"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        {kind !== "VOLUME" &&
          (kind === "MACD" ? (
            <div className="replay-fields three">
              {[
                ["Fast", fast, setFast],
                ["Slow", slow, setSlow],
                ["Signal", signal, setSignal],
              ].map(([label, value, set]) => (
                <label key={String(label)}>
                  {String(label)}
                  <input
                    type="number"
                    aria-label={"MACD " + String(label) + " Backtest"}
                    min="1"
                    max="500"
                    step="1"
                    required
                    disabled={busy}
                    value={String(value)}
                    onChange={(e) =>
                      (set as (s: string) => void)(e.target.value)
                    }
                  />
                </label>
              ))}
            </div>
          ) : (
            <label>
              Period
              <input
                aria-label="Period Backtest"
                type="number"
                min="1"
                max="500"
                step="1"
                required
                disabled={busy}
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </label>
          ))}
        <small>เพิ่มได้สูงสุด 8 ตัว · คำนวณจากแท่งที่เปิดเผยแล้วเท่านั้น</small>
        <button
          className="btn primary"
          disabled={busy || indicators.length >= 8}
        >
          เพิ่มอินดิเคเตอร์บนกราฟ
        </button>
      </form>
    </>
  );
}
export function ReflectionForm({
  trade,
  currency,
  busy,
  error,
  save,
  skip,
}: {
  trade: PracticeTrade;
  currency: string;
  busy: boolean;
  error: string;
  save: (body: object) => Promise<void>;
  skip: () => void;
}) {
  const [emotion, setEmotion] = useState(trade.review?.emotion || ""),
    [feelings, setFeelings] = useState(
      trade.review?.feelings || trade.review?.notes || "",
    ),
    [feedback, setFeedback] = useState(trade.review?.feedback || "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save({ emotion, feelings, feedback });
      }}
    >
      <p>
        {trade.side === "BUY" ? "Long" : "Short"} · {trade.exit_reason} ·{" "}
        {signed(trade.money_pnl)} {currency} · {signed(trade.net_r)} R
      </p>
      {(trade.decision.reason || trade.decision.emotion) && (
        <small>
          บันทึกเดิม: {trade.decision.emotion} · {trade.decision.reason}
        </small>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <label>
        อารมณ์หลังปิดไม้
        <input
          aria-label="อารมณ์หลังปิด Position"
          maxLength={200}
          disabled={busy}
          value={emotion}
          onChange={(e) => setEmotion(e.target.value)}
        />
      </label>
      <label>
        ความรู้สึก
        <textarea
          aria-label="ความรู้สึกหลังปิด Position"
          maxLength={5000}
          disabled={busy}
          value={feelings}
          onChange={(e) => setFeelings(e.target.value)}
        />
      </label>
      <label>
        Feedback ให้ไม้ถัดไป
        <textarea
          aria-label="Feedback ไม้ถัดไป"
          maxLength={5000}
          disabled={busy}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
      </label>
      <div className="backtest-dialog-actions">
        <button className="btn primary" disabled={busy}>
          บันทึกการทบทวน
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={busy}
          onClick={skip}
        >
          ข้ามไว้ก่อน
        </button>
      </div>
      <small>
        ไม่จำเป็นต้องกรอกตอนนี้ กลับมาเติมหรือแก้ไขในประวัติ Position ได้ภายหลัง
      </small>
    </form>
  );
}
