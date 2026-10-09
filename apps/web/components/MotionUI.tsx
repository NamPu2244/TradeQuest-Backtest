"use client";
import { useEffect, useState } from "react";
import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  m,
  MotionConfig,
  useReducedMotion,
} from "motion/react";
export function MotionUI({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig
        reducedMotion="user"
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
      >
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
export function ChartLoading({
  label = "กำลังเตรียมพื้นที่ของคุณ",
}: {
  label?: string;
}) {
  return (
    <div className="chart-loading" role="status" aria-label={label}>
      <svg viewBox="0 0 100 42" aria-hidden="true">
        <path className="loader-grid" d="M0 12H100M0 30H100" />
        <g className="loader-candles">
          {[18, 30, 13, 23, 7, 17, 5].map((y, i) => (
            <g key={i} style={{ animationDelay: `${i * -120}ms` }}>
              <path d={`M${10 + i * 13} ${y - 5}V${y + 20}`} />
              <rect x={7 + i * 13} y={y} width="6" height="12" rx="1.5" />
            </g>
          ))}
        </g>
        <path
          className="loader-trend"
          d="M5 33L20 25L32 29L48 17L63 21L78 10L95 6"
        />
      </svg>
      <span>{label}</span>
    </div>
  );
}
export function PageTransition({
  identity,
  children,
}: {
  identity: string;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const [transitioning, setTransitioning] = useState(false);
  useEffect(() => {
    if (reduced) {
      setTransitioning(false);
      return;
    }
    setTransitioning(true);
    const timer = setTimeout(() => setTransitioning(false), 240);
    return () => clearTimeout(timer);
  }, [identity, reduced]);
  return (
    <div className="page-transition-wrap">
      <AnimatePresence>
        {transitioning && (
          <m.div
            className="page-transition-indicator"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
          >
            <ChartLoading label="กำลังเปิดหน้า" />
          </m.div>
        )}
      </AnimatePresence>
      <m.div
        key={identity}
        className="page-surface"
        initial={{ opacity: reduced ? 1 : 0.4 }}
        animate={{ opacity: 1 }}
        transition={{ type: "spring", stiffness: 360, damping: 34 }}
      >
        {children}
      </m.div>
    </div>
  );
}
