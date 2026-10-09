"use client";
import { useState } from "react";
import { X, ChevronDown, ChevronUp } from "lucide-react";
import Modal from "../Modal";
import { num, signed } from "../types";
import { timeLabel } from "./backtest-utils";
import type { Session, PracticeTrade } from "./types";
export default function PracticePositions({
  session,
  busy,
  closePosition,
  closeAll,
  pause,
  review,
}: {
  session: Session;
  busy: boolean;
  closePosition: (id: string, lot?: number) => Promise<boolean>;
  closeAll: () => void;
  pause: () => void;
  review: (trade: PracticeTrade) => void;
}) {
  const [tab, setTab] = useState<"open" | "pending" | "closed">("open"),
    [collapsed, setCollapsed] = useState(false),
    [partial, setPartial] = useState<string | null>(null),
    [lot, setLot] = useState("");
  const active = session.trades.filter(
      (t) => t.status === "open" || t.status === "pending",
    ),
    selected = session.trades.find(
      (t) => t.id === partial && t.status === "open",
    );
  const rows = session.trades.filter((t) =>
    tab === "closed"
      ? t.status === "closed" || t.status === "cancelled"
      : t.status === tab,
  );
  const currency = session.config.currency || "USD";
  return (
    <section
      className={
        "practice-positions terminal-positions" +
        (collapsed ? " collapsed" : "")
      }
      aria-label="Position จำลองทั้งหมด"
      data-testid="practice-positions"
    >
      <header>
        <div
          className="position-tabs"
          role="tablist"
          aria-label="ประเภท Position"
        >
          {(["open", "pending", "closed"] as const).map((kind) => (
            <button
              role="tab"
              key={kind}
              aria-selected={tab === kind}
              onClick={() => {
                setTab(kind);
                setCollapsed(false);
              }}
            >
              {kind === "open"
                ? "Open"
                : kind === "pending"
                  ? "Pending"
                  : "Closed"}{" "}
              <span>
                {
                  session.trades.filter((t) =>
                    kind === "closed"
                      ? t.status === "closed" || t.status === "cancelled"
                      : t.status === kind,
                  ).length
                }
              </span>
            </button>
          ))}
        </div>
        <strong
          data-testid="positions-floating"
          className={
            (session.accounting?.floating_pnl || 0) >= 0
              ? "positive"
              : "negative"
          }
        >
          {signed(session.accounting?.floating_pnl)} {currency}
        </strong>
        <button
          className="btn ghost small"
          disabled={busy || !active.length}
          onClick={closeAll}
        >
          ปิดทั้งหมด / ยกเลิกรอเข้า
        </button>
        <button
          className="btn ghost small"
          aria-label={collapsed ? "ขยายตาราง Position" : "ย่อตาราง Position"}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </header>
      {!collapsed && (
        <div className="table-wrap terminal-position-scroll">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Type</th>
                <th>Volume, lot</th>
                <th>Open price</th>
                <th>{tab === "closed" ? "Exit price" : "Current price"}</th>
                <th>T/P</th>
                <th>S/L</th>
                <th>Open time</th>
                <th>P/L, {currency}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const number =
                    session.trades.findIndex((row) => row.id === t.id) + 1,
                  pnl =
                    t.status === "open"
                      ? t.floating_pnl
                      : (t.money_pnl ?? t.realized_pnl);
                return (
                  <tr key={t.id} data-testid={`practice-position-${t.id}`}>
                    <td>
                      <strong>{session.dataset.symbol}</strong>
                      <small>#{number}</small>
                    </td>
                    <td>
                      <span
                        className={
                          t.side === "BUY" ? "position-buy" : "position-sell"
                        }
                      >
                        {t.side === "BUY" ? "Buy" : "Sell"}
                      </span>
                      <small>
                        {t.status === "pending"
                          ? t.order_type
                          : t.status === "cancelled"
                            ? "ยกเลิก"
                            : t.exit_reason || ""}
                      </small>
                    </td>
                    <td>
                      {num(
                        t.status === "closed" || t.status === "cancelled"
                          ? t.decision.lot
                          : (t.remaining_lot ?? t.decision.lot),
                        8,
                      )}
                      {!!t.decision.partial_exits?.length && (
                        <small>
                          รับรู้แล้ว {signed(t.realized_pnl)} {currency}
                        </small>
                      )}
                    </td>
                    <td>
                      {num(
                        t.entry_price ??
                          t.requested_entry ??
                          t.decision.planned_entry,
                        5,
                      )}
                    </td>
                    <td>
                      {num(
                        tab === "closed" ? t.exit_price : t.current_price,
                        5,
                      )}
                    </td>
                    <td>{num(t.target_price, 5)}</td>
                    <td>{num(t.stop_price, 5)}</td>
                    <td>{t.entry_time ? timeLabel(t.entry_time) : "รอเข้า"}</td>
                    <td>
                      <strong
                        data-testid="position-floating"
                        className={(pnl || 0) >= 0 ? "positive" : "negative"}
                      >
                        {t.status === "pending" ? "—" : signed(pnl)}
                      </strong>
                    </td>
                    <td>
                      <div className="practice-position-actions">
                        {t.status === "open" && (
                          <button
                            className="btn ghost small"
                            disabled={busy}
                            aria-label={`ปิดบางส่วน Position #${number}`}
                            onClick={() => {
                              pause();
                              setPartial(t.id);
                              setLot(
                                String(
                                  Number(
                                    (
                                      (t.remaining_lot ?? t.decision.lot ?? 0) /
                                      2
                                    ).toFixed(12),
                                  ),
                                ),
                              );
                            }}
                          >
                            ปิดบางส่วน
                          </button>
                        )}
                        {t.status === "closed" && (
                          <button
                            className="btn ghost small"
                            onClick={() => {
                              pause();
                              review(t);
                            }}
                          >
                            รีวิว
                          </button>
                        )}
                        {(t.status === "open" || t.status === "pending") && (
                          <button
                            className="btn ghost small"
                            disabled={busy}
                            aria-label={
                              t.status === "pending"
                                ? `ยกเลิก Position #${number}`
                                : `ปิด Position #${number} ด้วยมือ`
                            }
                            onClick={() => void closePosition(t.id)}
                          >
                            <X size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={10} className="terminal-empty">
                    {tab === "open"
                      ? "ยังไม่มี Position เปิดอยู่"
                      : tab === "pending"
                        ? "ยังไม่มีคำสั่งรอเข้า"
                        : "ยังไม่มี Position ที่ปิด"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {selected && (
        <Modal
          title="ปิด Position บางส่วน"
          close={() => {
            if (!busy) setPartial(null);
          }}
        >
          <form
            className="practice-partial-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await closePosition(selected.id, Number(lot)))
                setPartial(null);
            }}
          >
            <p>
              {selected.side} · เหลือ {num(selected.remaining_lot, 8)} Lot · P/L{" "}
              {signed(selected.floating_pnl)} {currency}
            </p>
            <label>
              จำนวน Lot ที่ต้องการปิด
              <input
                aria-label="Lot ที่ปิดบางส่วน"
                type="number"
                step="any"
                min={0.000000000001}
                max={selected.remaining_lot}
                value={lot}
                required
                disabled={busy}
                onChange={(e) => setLot(e.target.value)}
              />
            </label>
            <p className="muted">
              ปิดที่ Bid สำหรับ BUY / Ask สำหรับ SELL ล่าสุดใน Replay ·
              ส่วนที่เหลือยังคงเปิดอยู่
            </p>
            <div>
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => setPartial(null)}
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                className="btn primary"
                disabled={
                  busy ||
                  !lot ||
                  !Number.isFinite(Number(lot)) ||
                  Number(lot) <= 0 ||
                  Number(lot) > (selected.remaining_lot || 0)
                }
              >
                ยืนยันปิดตาม Lot
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
