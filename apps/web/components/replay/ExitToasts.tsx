"use client";
import { useEffect } from "react";
import { AnimatePresence, m } from "motion/react";
import { CheckCircle2, X } from "lucide-react";
import { signed } from "../types";
import type { PracticeTrade } from "./types";
function Toast({
  trade,
  currency,
  dismiss,
  review,
}: {
  trade: PracticeTrade;
  currency: string;
  dismiss: (id: string) => void;
  review: (t: PracticeTrade) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => dismiss(trade.id), 8000);
    return () => clearTimeout(timer);
  }, [trade.id, dismiss]);
  return (
    <m.article
      className="exit-toast"
      data-testid={`exit-toast-${trade.id}`}
      role="status"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
    >
      <CheckCircle2 size={19} />
      <button
        className="exit-toast-review"
        onClick={() => review(trade)}
        aria-label={`รีวิว Position ${trade.id}`}
      >
        <strong>
          {trade.exit_reason === "ปิดเอง" ? "ปิดด้วยมือ" : trade.exit_reason} ·{" "}
          {trade.side}
        </strong>
        <span className={(trade.money_pnl || 0) >= 0 ? "positive" : "negative"}>
          {signed(trade.money_pnl)} {currency}
        </span>
        <small>กดเพื่อรีวิว</small>
      </button>
      <button
        className="exit-toast-dismiss"
        aria-label="ซ่อนแจ้งเตือนปิด Position"
        onClick={() => dismiss(trade.id)}
      >
        <X size={16} />
      </button>
    </m.article>
  );
}
export default function ExitToasts({
  trades,
  currency,
  dismiss,
  review,
}: {
  trades: PracticeTrade[];
  currency: string;
  dismiss: (id: string) => void;
  review: (t: PracticeTrade) => void;
}) {
  return (
    <aside
      className="exit-toast-stack"
      aria-label="แจ้งผล Position"
      aria-live="polite"
    >
      <AnimatePresence>
        {trades.map((t) => (
          <Toast
            key={t.id}
            trade={t}
            currency={currency}
            dismiss={dismiss}
            review={review}
          />
        ))}
      </AnimatePresence>
    </aside>
  );
}
