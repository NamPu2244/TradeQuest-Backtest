"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { m } from "motion/react";
import { X } from "lucide-react";

// Keep nested dialogs isolated, then restore the original page and focus.
const stack: HTMLElement[] = [];
const originalInert = new Map<HTMLElement, boolean>();
let originalOverflow = "";
function isolateDialogs() {
  const top = stack.at(-1);
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (top) {
      if (!originalInert.has(child)) originalInert.set(child, child.inert);
      child.inert = child !== top;
    }
  }
  if (!top) {
    for (const [child, inert] of originalInert) child.inert = inert;
    originalInert.clear();
    document.body.style.overflow = originalOverflow;
  }
}
export default function Modal({
  title,
  close,
  children,
  wide = false,
  closeLabel = "ปิดหน้าต่าง",
  className = "",
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  wide?: boolean;
  closeLabel?: string;
  className?: string;
}) {
  const shade = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  const backdropPress = useRef(false);
  useLayoutEffect(() => {
    closeRef.current = close;
  }, [close]);
  useEffect(() => {
    const root = shade.current!,
      element = frame.current!;
    const prior = document.activeElement as HTMLElement | null;
    if (!stack.length) originalOverflow = document.body.style.overflow;
    stack.push(root);
    document.body.style.overflow = "hidden";
    isolateDialogs();
    element.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (stack.at(-1) !== root) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        element.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
        ),
      ).filter(
        (control) =>
          control.getClientRects().length > 0 && !control.closest("[inert]"),
      );
      const first = controls[0],
        last = controls.at(-1);
      if (!first) {
        event.preventDefault();
        element.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === element)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === element)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      const index = stack.indexOf(root);
      if (index !== -1) stack.splice(index, 1);
      isolateDialogs();
      if (prior?.isConnected && !prior.closest("[inert]"))
        prior.focus({ preventScroll: true });
      else
        stack
          .at(-1)
          ?.querySelector<HTMLElement>('[role="dialog"]')
          ?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <m.div
      ref={shade}
      className="detail-modal-shade"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      onPointerDown={(e) => {
        backdropPress.current = e.target === e.currentTarget;
      }}
      onPointerUp={(e) => {
        if (backdropPress.current && e.target === e.currentTarget)
          closeRef.current();
        backdropPress.current = false;
      }}
    >
      <m.div
        ref={frame}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={
          "backtest-modal detail-modal" +
          (wide ? " detail-modal-wide" : "") +
          " " +
          className
        }
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
      >
        <div className="backtest-modal-head detail-modal-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="btn ghost small"
            onClick={close}
            aria-label={closeLabel}
          >
            <X size={20} />
          </button>
        </div>
        <div className="detail-modal-content">{children}</div>
      </m.div>
    </m.div>,
    document.body,
  );
}
