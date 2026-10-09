"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  Play,
  Pause,
  StepForward,
  StepBack,
  TrendingUp,
  TrendingDown,
  SlidersHorizontal,
  Maximize2,
  History,
  Trash2,
  Crosshair,
  Minus,
  Spline,
  RectangleHorizontal,
  ListTree,
  Layers3,
  Undo2,
  Redo2,
  Code2,
} from "lucide-react";
import { api, num, signed } from "../types";
import PineEditor from "./PineEditor";
import ReplayChart from "./ReplayChart";
import Modal from "../Modal";
import Link from "next/link";
import FiboSettingsModal from "./FiboSettingsModal";
import PracticePositions from "./PracticePositions";
import ExitToasts from "./ExitToasts";
import {
  Dialog,
  PositionForm,
  IndicatorForm,
  ReflectionForm,
} from "./BacktestForms";
import { intervals } from "./chart-coordinates";
import { timeLabel, toolNames } from "./backtest-utils";
import type {
  Drawing,
  Indicator,
  PracticeTrade,
  Session,
  PositionDraft,
} from "./types";
export default function BacktestWorkspace({
  session,
  onSession,
  onBack,
  onCopy,
}: {
  session: Session;
  onSession: (s: Session) => void;
  onBack: () => void;
  onCopy: () => void;
}) {
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [session.id]);
  const [pineEditor, setPineEditor] = useState(false);
  const [tool, setTool] = useState<Drawing["kind"] | "">(""),
    [draft, setDraft] = useState<PositionDraft | null>(null),
    [settings, setSettings] = useState(false),
    [indicatorDialog, setIndicatorDialog] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [immersive, setImmersive] = useState(false),
    [history, setHistory] = useState(false),
    [objects, setObjects] = useState(false);
  const [fiboObject, setFiboObject] = useState<Drawing | null>(null);
  const [undoStack, setUndoStack] = useState<Drawing[][]>([]),
    [redoStack, setRedoStack] = useState<Drawing[][]>([]);
  const [reflection, setReflection] = useState<PracticeTrade | null>(null),
    [notices, setNotices] = useState<PracticeTrade[]>([]);
  const dismissNotice = useCallback(
    (id: string) => setNotices((rows) => rows.filter((t) => t.id !== id)),
    [],
  );
  const [rewindNotice, setRewindNotice] = useState("");
  const current = useRef(session),
    busyRef = useRef(false),
    commandPending = useRef(false),
    inFlight = useRef<Promise<void> | null>(null),
    stepRef = useRef(() => {});
  useLayoutEffect(() => {
    current.current = session;
  }, [session]);
  const accept = useCallback(
    (next: Session, previous: Session) => {
      current.current = next;
      onSession(next);
      const fresh = next.trades.filter(
        (t) =>
          t.status === "closed" &&
          !previous.trades.some(
            (old) => old.id === t.id && old.status === "closed",
          ),
      );
      if (fresh.length) {
        setNotices((rows) =>
          [
            ...rows.filter((t) => !fresh.some((f) => f.id === t.id)),
            ...fresh,
          ].slice(-5),
        );
      }
      if (next.cursor >= next.end_cursor) setPlaying(false);
    },
    [onSession],
  );
  const act = useCallback(
    async (
      action: string,
      body: object = {},
      method = "POST",
      background = false,
    ): Promise<Session | null> => {
      if (background && (busyRef.current || commandPending.current))
        return null;
      if (!background) {
        if (commandPending.current) return null;
        commandPending.current = true;
        setPlaying(false);
        setBusy(true);
        // A manual action waits for the last automatic tick and uses its fresh revision.
        await inFlight.current;
      }
      busyRef.current = true;
      let release!: () => void;
      inFlight.current = new Promise<void>((resolve) => {
        release = resolve;
      });
      setError("");
      const previous = current.current;
      try {
        const next = await api<Session>(
          `replay/sessions/${previous.id}/${action}`,
          {
            method,
            body: JSON.stringify({
              ...(action.endsWith("/reflection")
                ? {}
                : { revision: previous.revision }),
              ...body,
            }),
          },
        );
        accept(next, previous);
        return next;
      } catch (e) {
        setPlaying(false);
        setError(String(e));
        try {
          accept(
            await api<Session>("replay/sessions/" + previous.id),
            previous,
          );
        } catch {}
        return null;
      } finally {
        busyRef.current = false;
        inFlight.current = null;
        release();
        if (!background) {
          commandPending.current = false;
          setBusy(false);
        }
      }
    },
    [accept],
  );
  const rewind = useCallback(async () => {
    setPlaying(false);
    if (commandPending.current) return;
    const activeIds = current.current.trades
      .filter((t) => ["pending", "open"].includes(t.status))
      .map((t) => t.id);
    const next = await act("rewind");
    if (next) {
      setDraft(null);
      setTool("");
      setSettings(false);
      setNotices([]);
      setRewindNotice(
        next.trades.some(
          (t) =>
            activeIds.includes(t.id) &&
            t.status === "cancelled" &&
            t.exit_reason === "ยกเลิกจากการย้อน Replay",
        )
          ? "ย้อนแท่งแล้ว · ยกเลิก Position จำลองที่ยังเปิดหรือรอเข้าอยู่"
          : "ย้อนแท่งแล้ว · ฝึกเข้าไม้ใหม่จากจุดนี้ได้",
      );
    }
  }, [act]);
  const playClock = useRef(0);
  const tickMode = session.config.replay_mode === "ticks";
  const timeframe = session.config.timeframe || session.dataset.timeframe;
  useLayoutEffect(() => {
    stepRef.current = () => {
      if (busyRef.current) return;
      const now = Date.now();
      const elapsed = Math.max(1, now - (playClock.current || now - 250));
      playClock.current = now;
      void act(
        tickMode ? "advance" : "step",
        tickMode
          ? { milliseconds: Math.min(3600000, Math.round(elapsed * speed)) }
          : {},
        "POST",
        true,
      );
    };
  }, [act, tickMode, speed]);
  useEffect(() => {
    if (!playing) return;
    playClock.current = Date.now();
    const timer = setInterval(
      () => stepRef.current(),
      tickMode ? 250 : 1000 / speed,
    );
    return () => clearInterval(timer);
  }, [playing, speed, tickMode]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName;
      if (
        ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(tag) ||
        settings ||
        indicatorDialog ||
        pineEditor ||
        reflection ||
        objects ||
        history
      )
        return;
      if (event.code === "Space") {
        event.preventDefault();
        if (
          !draft &&
          current.current.status === "active" &&
          current.current.cursor < current.current.end_cursor
        )
          setPlaying((old) => !old);
      }
      if (event.code === "ArrowLeft" && current.current.cursor > 0) {
        event.preventDefault();
        void rewind();
      }
      if (event.code === "ArrowRight" && !draft) {
        event.preventDefault();
        setPlaying(false);
        if (
          current.current.status === "active" &&
          current.current.cursor < current.current.end_cursor
        )
          void act("step");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [
    settings,
    indicatorDialog,
    pineEditor,
    reflection,
    objects,
    history,
    act,
    rewind,
    draft,
  ]);
  const currency = session.config.currency || "USD";
  const money = (value: number | null | undefined) =>
    num(value, 2) + " " + currency;
  const last = session.bars.at(-1)!;
  const active = session.trades.find(
    (t) => t.status === "pending" || t.status === "open",
  );
  const canTrade =
    session.config.workspace === "backtest" &&
    session.status === "active" &&
    session.cursor < session.end_cursor &&
    (session.accounting?.balance || 0) > 0;
  const canStep =
    session.status === "active" &&
    session.cursor < session.end_cursor &&
    !busy &&
    !draft;
  const begin = (side: "BUY" | "SELL") => {
    setPlaying(false);
    setTool("");
    const bars = session.bars.slice(-30),
      range = Math.max(
        (Math.max(...bars.map((b) => b.high)) -
          Math.min(...bars.map((b) => b.low))) *
          0.2,
        last.close * 0.0001,
      );
    const entry = session.quote
      ? side === "BUY"
        ? session.quote.ask
        : session.quote.bid
      : last.close + (side === "BUY" ? session.config.spread : 0);
    const distance = Math.min(range, entry * 0.2);
    setDraft({
      side,
      order_type: "MARKET",
      entry,
      sl: entry + (side === "BUY" ? -distance : distance),
      tp: entry + (side === "BUY" ? distance : -distance),
      lot: 0.01,
      time: last.time,
      end_time: last.time + intervals[timeframe] * 12,
    });
  };
  const change = (next: PositionDraft) => {
    const reference = session.quote
      ? next.side === "BUY"
        ? session.quote.ask
        : session.quote.bid
      : last.close + (next.side === "BUY" ? session.config.spread : 0);
    if (draft && Math.abs(next.entry - draft.entry) > 1e-9)
      next = {
        ...next,
        order_type:
          Math.abs(next.entry - reference) < 1e-8
            ? "MARKET"
            : (
                  next.side === "BUY"
                    ? next.entry < reference
                    : next.entry > reference
                )
              ? "LIMIT"
              : "STOP",
      };
    setDraft(next);
  };
  const displayPosition =
    draft ||
    (active
      ? {
          side: active.side,
          order_type: active.order_type,
          entry: active.entry_price ?? active.requested_entry ?? last.close,
          sl: active.stop_price,
          tp: active.target_price,
          lot: active.decision.lot || 0.01,
          time:
            active.decision.position_drawing?.time ??
            active.entry_time ??
            last.time,
          end_time: active.decision.position_drawing?.end_time,
        }
      : null);
  const saveVisuals = async (drawings: Drawing[], indicators: Indicator[]) => {
    const before = structuredClone(current.current.drawings);
    const next = await act("visuals", { drawings, indicators }, "PUT");
    if (next && JSON.stringify(before) !== JSON.stringify(drawings)) {
      setUndoStack((stack) => [...stack.slice(-49), before]);
      setRedoStack([]);
    }
    return next;
  };
  const restoreDrawing = async (direction: "undo" | "redo") => {
    const stack = direction === "undo" ? undoStack : redoStack;
    const drawings = stack.at(-1);
    if (!drawings || busyRef.current || commandPending.current) return;
    const before = structuredClone(current.current.drawings);
    const next = await act(
      "visuals",
      { drawings, indicators: current.current.indicators },
      "PUT",
    );
    if (!next) return;
    if (direction === "undo") {
      setUndoStack((stack) => stack.slice(0, -1));
      setRedoStack((stack) => [...stack.slice(-49), before]);
    } else {
      setRedoStack((stack) => stack.slice(0, -1));
      setUndoStack((stack) => [...stack.slice(-49), before]);
    }
  };
  const closeSettings = useCallback(() => {
    if (!busyRef.current) setSettings(false);
  }, []);
  const closeIndicators = useCallback(() => {
    if (!busyRef.current) setIndicatorDialog(false);
  }, []);
  const closeReflection = useCallback(() => {
    if (!busyRef.current) setReflection(null);
  }, []);
  return (
    <div
      className={
        "replay-page backtest-workspace " + (immersive ? "immersive" : "")
      }
      data-testid="backtest-workspace"
    >
      <header className="backtest-topbar">
        <button
          className="btn ghost small"
          disabled={busy}
          onClick={() => {
            setPlaying(false);
            void (async () => {
              await inFlight.current;
              onBack();
            })();
          }}
        >
          <ArrowLeft size={16} />
          โปรไฟล์ทั้งหมด
        </button>
        <Link
          className="terminal-brand"
          href="/"
          aria-label="TradeQuest Backtest"
        >
          TQ<span>REPLAY</span>
        </Link>
        <div className="terminal-symbol-tab">
          <span>{session.dataset.symbol.includes("BTC") ? "₿" : "◈"}</span>
          {session.dataset.symbol}
        </div>
        <div className="backtest-title">
          <strong>{session.name}</strong>
          <small>
            {session.dataset.synthetic ? "DEMO DATA" : "ราคาย้อนหลัง"}
          </small>
        </div>
        <div className="terminal-equity">
          <small>บัญชีจำลอง · {currency}</small>
          <strong>{money(session.accounting?.equity)}</strong>
        </div>
        <button
          className="btn ghost small"
          aria-label="ขยายพื้นที่กราฟ"
          onClick={() => setImmersive(!immersive)}
        >
          <Maximize2 size={17} />
        </button>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="backtest-chart-toolbar">
        <strong>{session.dataset.symbol}</strong>
        <select
          aria-label="Timeframe Backtest"
          value={timeframe}
          disabled={busy}
          onChange={(e) => {
            setTool("");
            void act("timeframe", { timeframe: e.target.value }, "PUT");
          }}
        >
          {(session.timeframes || [session.dataset.timeframe]).map((tf) => (
            <option key={tf}>{tf}</option>
          ))}
        </select>
        <strong>
          <small>
            {tickMode
              ? session.dataset.synthetic
                ? "DEMO ticks"
                : "Real ticks · " + session.dataset.provider
              : "Bar data"}
          </small>
        </strong>
        <button
          className="btn ghost small"
          disabled={busy}
          onClick={() => {
            setPlaying(false);
            setIndicatorDialog(true);
          }}
        >
          <SlidersHorizontal size={16} />
          อินดิเคเตอร์
        </button>
        <button
          className={"btn ghost small " + (pineEditor ? "active" : "")}
          disabled={busy}
          onClick={() => {
            setPlaying(false);
            setPineEditor((v) => !v);
          }}
        >
          <Code2 size={16} /> Pine Editor
        </button>
        <span className="backtest-toolbar-divider" />
        <button
          className="btn ghost small studio-icon"
          aria-label="Undo ภาพวาด"
          title="ย้อนการแก้ภาพวาด"
          disabled={busy || !undoStack.length}
          onClick={() => void restoreDrawing("undo")}
        >
          <Undo2 size={18} />
        </button>
        <button
          className="btn ghost small studio-icon"
          aria-label="Redo ภาพวาด"
          title="ทำซ้ำการแก้ภาพวาด"
          disabled={busy || !redoStack.length}
          onClick={() => void restoreDrawing("redo")}
        >
          <Redo2 size={18} />
        </button>
        <button
          className="btn ghost small studio-objects"
          disabled={busy}
          onClick={() => {
            setPlaying(false);
            setObjects(true);
          }}
        >
          <Layers3 size={17} />
          ภาพวาด ({session.drawings.length})
        </button>
        <div className="terminal-quote-actions">
          <strong
            className={
              (session.accounting?.floating_pnl || 0) >= 0
                ? "positive"
                : "negative"
            }
          >
            {signed(session.accounting?.floating_pnl)} {currency}
          </strong>
          <button
            className="terminal-sell"
            aria-label="เปิด Sell จำลอง"
            disabled={!canTrade || busy || !!draft}
            onClick={() => {
              begin("SELL");
              setSettings(true);
            }}
          >
            Sell {num(session.quote?.bid ?? last.close, 5)}
          </button>
          <small aria-label="Spread ปัจจุบัน">
            {num(
              (session.quote?.ask ?? last.close) -
                (session.quote?.bid ?? last.close),
              5,
            )}
          </small>
          <button
            className="terminal-buy"
            aria-label="เปิด Buy จำลอง"
            disabled={!canTrade || busy || !!draft}
            onClick={() => {
              begin("BUY");
              setSettings(true);
            }}
          >
            Buy {num(session.quote?.ask ?? last.close, 5)}
          </button>
        </div>
      </div>
      {rewindNotice && (
        <p role="status" className="muted">
          {rewindNotice}
        </p>
      )}
      {!!session.config.replay_generation && (
        <small className="muted">
          ไม้ที่ปิดแล้วและกำไรสะสมยังอยู่ในประวัติ · ย้อนแท่งจะยกเลิกเฉพาะ
          Position จำลองที่ยังเปิดหรือรอเข้า
        </small>
      )}
      <div className="backtest-chart-area">
        <aside className="backtest-drawbar">
          <button
            aria-label="เลื่อนกราฟ Backtest"
            title="เลื่อนกราฟ"
            className={!tool ? "selected" : ""}
            onClick={() => setTool("")}
            disabled={busy}
          >
            <Crosshair size={23} />
          </button>
          {(Object.keys(toolNames) as Drawing["kind"][]).map((kind) => (
            <button
              key={kind}
              aria-label={toolNames[kind] + " Backtest"}
              title={toolNames[kind]}
              className={tool === kind ? "selected" : ""}
              disabled={busy}
              onClick={() => setTool(kind)}
            >
              {kind === "horizontal" ? (
                <Minus size={23} />
              ) : kind === "trend" ? (
                <Spline size={23} />
              ) : kind === "zone" ? (
                <RectangleHorizontal size={23} />
              ) : (
                <ListTree size={23} />
              )}
            </button>
          ))}
          <span />
          <button
            aria-label="วาง Long Position"
            title="Long Position"
            className="long"
            disabled={!canTrade || busy || !!draft}
            onClick={() => begin("BUY")}
          >
            <TrendingUp size={20} />
            <small>Long</small>
          </button>
          <button
            aria-label="วาง Short Position"
            title="Short Position"
            className="short"
            disabled={!canTrade || busy || !!draft}
            onClick={() => begin("SELL")}
          >
            <TrendingDown size={20} />
            <small>Short</small>
          </button>
        </aside>
        <div className="backtest-chart-canvas">
          <div className="backtest-ohlc">
            <strong>
              {session.dataset.symbol} · {timeframe}
            </strong>
            <span
              className={last.close >= last.open ? "studio-up" : "studio-down"}
            >
              O {num(last.open, 5)} · H {num(last.high, 5)} · L{" "}
              {num(last.low, 5)} · C {num(last.close, 5)}
            </span>
          </div>
          <ReplayChart
            session={session}
            tool={tool}
            onDraw={async (drawing) => {
              const next = await saveVisuals(
                [...current.current.drawings, drawing],
                current.current.indicators,
              );
              if (next) setTool("");
              return !!next;
            }}
            onDrawingsChange={async (drawings) =>
              !!(await saveVisuals(drawings, current.current.indicators))
            }
            onDrawingInteract={() => setPlaying(false)}
            onCancelTool={() => setTool("")}
            position={displayPosition}
            positionEditable={!!draft && !tool}
            onPositionChange={change}
            onClosePosition={(id) => {
              void act("close", { trade_id: id });
            }}
            positionBusy={busy}
            onPositionSettings={() => {
              if (draft && !busy) setSettings(true);
            }}
          />
          {pineEditor && (
            <PineEditor
              session={session}
              close={() => setPineEditor(false)}
              apply={async (i) =>
                !!(await saveVisuals(current.current.drawings, [
                  ...current.current.indicators.filter((x) => x.id !== i.id),
                  i,
                ]))
              }
            />
          )}
          <div className="backtest-chart-footer">
            <span data-testid="backtest-cursor">
              {(session.cursor + 1).toLocaleString()} /{" "}
              {(session.end_cursor + 1).toLocaleString()}{" "}
              {tickMode ? "ticks" : "แท่ง"}
            </span>
            <small>
              กราฟ UTC · อนาคตยังซ่อนอยู่ · Space เล่น/หยุด · ← ย้อนแท่ง · →
              ข้ามแท่ง
            </small>
          </div>
        </div>
      </div>
      <div
        className="backtest-replay-controls"
        data-testid="backtest-replay-controls"
      >
        <strong className="backtest-replay-label">Bar Replay</strong>
        <button
          className="btn ghost small"
          disabled={!playing && !canStep}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}{" "}
          {playing ? "หยุด Replay" : "เล่น Replay"}
        </button>
        <button
          className="btn ghost small"
          disabled={busy || session.cursor === 0}
          onClick={() => void rewind()}
          title="ย้อนแท่งตาม TF และยกเลิก Position ที่ยังเปิดหรือรอเข้า"
        >
          <StepBack size={16} /> ย้อนแท่ง
        </button>
        <button
          className="btn ghost small"
          disabled={!canStep}
          onClick={() => {
            setPlaying(false);
            void act("step");
          }}
        >
          <StepForward size={16} />
          ทีละแท่ง
        </button>
        <select
          aria-label="ความเร็ว Backtest"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        >
          {(tickMode ? [0.5, 1, 2, 4, 8, 16, 60, 240] : [0.5, 1, 2, 4]).map(
            (n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ),
          )}
        </select>
        {tickMode && (
          <button
            className="btn ghost small"
            disabled={!canStep}
            onClick={() => {
              setPlaying(false);
              void act("advance", { one_tick: true });
            }}
          >
            ทีละ Tick
          </button>
        )}
        <small data-testid="replay-clock">
          {tickMode ? "Tick Replay" : "Bar Replay"} ·{" "}
          {timeLabel((session.replay_time_ms || last.time * 1000) / 1000)}{" "}
          (เวลาเครื่องคุณ)
        </small>
      </div>
      {draft && (
        <div className="backtest-position-banner">
          <strong>
            {draft.side === "BUY" ? "Long" : "Short"} Position · {draft.lot} Lot
          </strong>
          <span>
            ลากกรอบทั้งชิ้น · ลากจุด Entry / TP / SL ·
            คลิกขวาหรือดับเบิลคลิกเพื่อกรอกรายละเอียด
          </span>
          <button
            className="btn primary small"
            onClick={() => setSettings(true)}
          >
            รายละเอียด Position
          </button>
          <button
            className="btn ghost small"
            disabled={busy}
            onClick={() => {
              setDraft(null);
              setSettings(false);
            }}
          >
            ยกเลิกกรอบ
          </button>
        </div>
      )}
      <PracticePositions
        session={session}
        busy={busy}
        review={(trade) => setReflection(trade)}
        pause={() => setPlaying(false)}
        closePosition={async (id, lot) =>
          !!(await act("close", {
            trade_id: id,
            ...(lot === undefined ? {} : { lot }),
          }))
        }
        closeAll={() => {
          void act("close-all");
        }}
      />
      <ExitToasts
        trades={notices}
        currency={currency}
        dismiss={dismissNotice}
        review={(trade) => {
          setPlaying(false);
          setReflection(trade);
          dismissNotice(trade.id);
        }}
      />
      {session.accounting ? (
        <div className="backtest-account" data-testid="backtest-account">
          {[
            ["เงินเริ่มต้น", session.accounting.initial_balance],
            ["Balance", session.accounting.balance],
            ["Equity", session.accounting.equity],
            ["กำไรขาดทุนสุทธิ", session.accounting.net_pnl],
            ["กำไรขาดทุนลอยตัว", session.accounting.floating_pnl],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <small>{label}</small>
              <strong>{money(Number(value))}</strong>
            </div>
          ))}
          <div>
            <small>จำนวนไม้ / เป้าหมาย</small>
            <strong>
              {session.stats.trades} / {session.config.target_trades}
            </strong>
          </div>
        </div>
      ) : (
        <div className="backtest-legacy-hint">
          รอบนี้ยังไม่ได้กำหนดเงินเริ่มต้น{" "}
          <button
            className="btn ghost small"
            disabled={busy || !!active}
            onClick={() => {
              if (!busyRef.current) {
                setPlaying(false);
                onCopy();
              }
            }}
          >
            สร้างโปรไฟล์ใหม่จากชุดข้อมูลนี้
          </button>
        </div>
      )}
      <div className="backtest-bottom">
        <div>
          <small>เป้าหมาย</small>
          <span>{session.config.goal || "ฝึกอ่านกราฟ"}</span>
          {session.config.target_trades &&
            session.stats.trades >= session.config.target_trades && (
              <strong>ครบจำนวนไม้เป้าหมายแล้ว</strong>
            )}
        </div>
        <div>
          <small>
            Win rate {num(session.stats.win_rate, 1)}% · Net{" "}
            {signed(session.stats.net_r)} R · แพ้ติดกันสูงสุด{" "}
            {session.stats.max_losing_streak}
          </small>
          <button
            className="btn ghost small"
            onClick={() => {
              setPlaying(false);
              setHistory(true);
            }}
          >
            <History size={16} />
            ประวัติและทบทวน
          </button>
          <button
            className="btn ghost small"
            disabled={
              busy || !!active || !!draft || session.status !== "active"
            }
            onClick={() => void act("finish")}
          >
            {session.status === "finished" ? "โปรไฟล์จบรอบแล้ว" : "จบรอบฝึก"}
          </button>
        </div>
      </div>
      {session.cursor === session.end_cursor && (
        <p className="backtest-end">
          ถึงข้อมูลสุดท้ายแล้ว{" "}
          {active
            ? "ปิดหรือยกเลิก Position ก่อนจบรอบฝึก"
            : "ทบทวนประวัติ หรือจบรอบฝึกได้"}
        </p>
      )}
      {objects && (
        <Modal title="ภาพวาดบนกราฟ" close={() => setObjects(false)}>
          <div className="studio-object-list">
            {!session.drawings.length && (
              <p className="muted">
                ยังไม่มีภาพวาด · เลือกเครื่องมือจากแถบด้านซ้ายเพื่อเริ่มวาด
              </p>
            )}
            {session.drawings.map((d) => (
              <div key={d.id}>
                <span>
                  <strong>{d.label || toolNames[d.kind]}</strong>
                  <small>
                    {toolNames[d.kind]}
                    {d.locked ? " · ล็อกไว้" : ""}
                  </small>
                </span>
                {d.kind === "fibo" && (
                  <button
                    className="btn ghost small"
                    disabled={busy}
                    onClick={() => {
                      setObjects(false);
                      setFiboObject(d);
                    }}
                  >
                    ตั้งค่า {d.label || toolNames[d.kind]}
                  </button>
                )}
                <button
                  className="btn ghost small"
                  disabled={busy}
                  onClick={() =>
                    void saveVisuals(
                      session.drawings.filter((x) => x.id !== d.id),
                      session.indicators,
                    )
                  }
                >
                  <Trash2 size={16} />
                  ลบ {d.label || toolNames[d.kind]}
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {fiboObject && (
        <FiboSettingsModal
          key={fiboObject.id}
          drawing={fiboObject}
          busy={busy}
          close={() => setFiboObject(null)}
          save={async (drawing) =>
            !!(await saveVisuals(
              current.current.drawings.map((d) =>
                d.id === drawing.id ? drawing : d,
              ),
              current.current.indicators,
            ))
          }
        />
      )}
      {history && (
        <Modal title="ประวัติ Position" close={() => setHistory(false)} wide>
          <section className="backtest-history">
            {!session.trades.length ? (
              <p className="muted">ยังไม่มี Position</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ไม้</th>
                      <th>Position</th>
                      <th>Entry → Exit</th>
                      <th>ผล</th>
                      <th>บันทึก</th>
                      <th>ทบทวน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.trades.map((t, index) => (
                      <tr key={t.id}>
                        <td>#{index + 1}</td>
                        <td>
                          {t.side === "BUY" ? "Long" : "Short"}{" "}
                          {t.decision.lot || "—"} Lot
                          <br />
                          <small>
                            {t.status === "closed"
                              ? t.exit_reason
                              : t.status === "pending"
                                ? "รอเข้า"
                                : t.status === "cancelled"
                                  ? t.exit_reason
                                  : "เปิดอยู่"}
                          </small>
                        </td>
                        <td>
                          {num(t.entry_price, 5)} → {num(t.exit_price, 5)}
                          <br />
                          <small>
                            {t.entry_time ? timeLabel(t.entry_time) : "—"}
                          </small>
                        </td>
                        <td>
                          {money(t.money_pnl ?? t.realized_pnl)}
                          {!!t.decision.partial_exits?.length && (
                            <details>
                              <summary>
                                ปิดบางส่วน {t.decision.partial_exits.length}{" "}
                                ครั้ง
                              </summary>
                              {t.decision.partial_exits.map((exit, i) => (
                                <small key={i}>
                                  {num(exit.lot, 8)} Lot @ {num(exit.price, 5)}{" "}
                                  · {money(exit.money_pnl)} ·{" "}
                                  {timeLabel(exit.exit_time_ms / 1000)}
                                </small>
                              ))}
                            </details>
                          )}
                          <br />
                          <small>{signed(t.net_r)} R</small>
                        </td>
                        <td>
                          {t.decision.reason || "—"}
                          <br />
                          <small>ก่อนเข้า: {t.decision.emotion || "—"}</small>
                          {t.review && (
                            <button
                              type="button"
                              className="text-btn gold"
                              onClick={() => {
                                setHistory(false);
                                setReflection(t);
                              }}
                            >
                              ดูบันทึกหลังปิดไม้
                            </button>
                          )}
                        </td>
                        <td>
                          <button
                            className="btn ghost small"
                            disabled={busy || t.status !== "closed"}
                            onClick={() => {
                              setPlaying(false);
                              setHistory(false);
                              setReflection(t);
                            }}
                          >
                            {t.review ? "แก้ไขบันทึก" : "ทบทวน"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </Modal>
      )}
      {settings && draft && (
        <Dialog title="รายละเอียด Position" close={closeSettings}>
          <PositionForm
            draft={draft}
            change={change}
            pointValue={session.config.point_value || 1}
            currency={currency}
            busy={busy}
            reference={
              session.quote
                ? draft.side === "BUY"
                  ? session.quote.ask
                  : session.quote.bid
                : last.close +
                  (draft.side === "BUY" ? session.config.spread : 0)
            }
            error={error}
            submit={async () => {
              const next = await act("positions", {
                side: draft.side,
                order_type: draft.order_type,
                entry: draft.entry,
                sl: draft.sl,
                tp: draft.tp,
                lot: draft.lot,
                drawing_time: draft.time,
                drawing_end_time:
                  draft.end_time ?? draft.time + intervals[timeframe] * 12,
              });
              if (next) {
                setDraft(null);
                setSettings(false);
              }
            }}
          />
        </Dialog>
      )}
      {indicatorDialog && (
        <Dialog title="อินดิเคเตอร์บนกราฟ" close={closeIndicators}>
          <IndicatorForm
            indicators={session.indicators}
            busy={busy}
            error={error}
            add={async (i) => {
              if (
                await saveVisuals(session.drawings, [...session.indicators, i])
              )
                setIndicatorDialog(false);
            }}
            remove={(i) =>
              void saveVisuals(
                session.drawings,
                session.indicators.filter((x) => x.id !== i.id),
              )
            }
          />
        </Dialog>
      )}
      {reflection && (
        <Dialog title="ทบทวนหลังปิด Position" close={closeReflection}>
          <ReflectionForm
            key={reflection.id}
            trade={reflection}
            currency={currency}
            busy={busy}
            error={error}
            skip={closeReflection}
            save={async (body) => {
              if (
                await act(`trades/${reflection.id}/reflection`, body, "PUT")
              ) {
                setReflection(null);
                setNotices([]);
              }
            }}
          />
        </Dialog>
      )}
    </div>
  );
}
