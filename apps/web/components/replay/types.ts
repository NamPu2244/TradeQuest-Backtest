export type Bar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
export type Dataset = {
  id: string;
  name: string;
  symbol: string;
  timeframe: string;
  source: string;
  synthetic: boolean;
  count: number;
  first_time: number;
  last_time: number;
  gaps: number;
  limited_history?: boolean;
  storage?: string;
  tick_count?: number;
  price_scale?: number;
  provider?: string;
  complete_calendar_scan?: boolean;
  year?: number;
};
export type Point = { time: number; price: number };
export type FiboLevel = { value: number; enabled: boolean; color: string };
export type FiboSettings = {
  levels: FiboLevel[];
  extend: "none" | "left" | "right" | "both";
  reverse: boolean;
  trend_line: boolean;
  trend_color: string;
  trend_style: "solid" | "dashed" | "dotted";
  background: boolean;
  background_opacity: number;
  single_color: boolean;
  single_color_value: string;
  show_prices: boolean;
  show_levels: boolean;
  level_format: "value" | "percent";
  label_position: "left" | "center" | "right";
  label_vertical: "top" | "center" | "bottom";
  show_text: boolean;
  text_position: "left" | "center" | "right";
  text_vertical: "top" | "center" | "bottom";
  font_size: number;
  timeframes: string[];
};
export type Drawing = {
  id: string;
  kind: "horizontal" | "trend" | "zone" | "fibo";
  points: Point[];
  label: string;
  color?: string;
  line_width?: number;
  line_style?: "solid" | "dashed" | "dotted";
  locked?: boolean;
  fibo?: FiboSettings;
};
export type BuiltinIndicator = {
  id: string;
  kind: "EMA" | "SMA" | "RSI" | "MACD" | "VOLUME";
  period: number;
  fast: number;
  slow: number;
  signal: number;
};
export type PineVersion = {
  version: number;
  name: string;
  source: string;
  source_hash: string;
  runtime_version: string;
  created_at: string;
};
export type PineScript = {
  id: string;
  latest_version: number;
  archived: boolean;
  versions: PineVersion[];
};
export type PineIndicator = Omit<PineVersion, "version" | "created_at"> & {
  id: string;
  kind: "PINE";
  script_id: string;
  script_version: number;
  inputs: Record<string, number | boolean | string>;
};
export type Indicator = BuiltinIndicator | PineIndicator;
export type PlaybookSnapshot = {
  playbook_id: string;
  playbook_name: string;
  playbook_version: number;
  rules: Record<string, unknown>;
};
export type PracticeTrade = {
  id: string;
  status: string;
  side: "BUY" | "SELL";
  order_type: "MARKET" | "LIMIT" | "STOP";
  requested_entry: number | null;
  entry_price: number | null;
  stop_price: number;
  target_price: number;
  entry_time: number | null;
  exit_time: number | null;
  exit_price: number | null;
  net_r: number | null;
  exit_reason: string | null;
  ambiguous: boolean;
  playbook_snapshot: Partial<PlaybookSnapshot>;
  money_pnl: number | null;
  remaining_lot?: number;
  realized_pnl?: number | null;
  floating_pnl?: number | null;
  current_price?: number | null;
  decision: {
    workspace?: string;
    entry_time_ms?: number;
    entry_tick_index?: number;
    exit_tick_index?: number;
    exit_time_ms?: number;
    replay_generation?: number;
    lot?: number;
    point_value?: number;
    currency?: string;
    position_drawing?: { time: number; end_time: number };
    reason?: string;
    emotion?: string;
    planned_entry?: number;
    initial_stop?: number;
    partial_exits?: {
      lot: number;
      price: number;
      money_pnl: number;
      net_r: number;
      exit_time_ms: number;
      exit_tick_index: number;
      exit_bid: number;
      exit_ask: number;
    }[];
  };
  review: {
    in_plan: boolean | null;
    emotion: string;
    notes: string;
    playbook_snapshot: Partial<PlaybookSnapshot>;
    feelings?: string;
    feedback?: string;
  } | null;
};
export type PracticeStats = {
  trades: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  net_r: number;
  average_r: number | null;
  in_plan_percent: number | null;
  reviewed: number;
  max_losing_streak: number;
  ambiguous: number;
  by_setup: {
    key: string;
    name: string;
    version: number;
    trades: number;
    win_rate: number;
    net_r: number;
    average_r: number;
    in_plan_percent: number | null;
    max_losing_streak: number;
  }[];
};
export type Session = {
  id: string;
  name: string;
  dataset: Dataset;
  cursor: number;
  end_cursor: number;
  revision: number;
  status: string;
  bars: Bar[];
  config: ProfileConfig;
  accounting: Accounting | null;
  quote?: { time_ms: number; bid: number; ask: number };
  replay_time_ms?: number;
  timeframes?: string[];
  drawings: Drawing[];
  indicators: Indicator[];
  trades: PracticeTrade[];
  stats: PracticeStats;
};
export type SessionSummary = Pick<
  Session,
  "id" | "name" | "dataset" | "cursor" | "status" | "config"
>;

export type ProfileConfig = {
  spread: number;
  commission_r: number;
  workspace?: "backtest";
  timeframe?: string;
  replay_mode?: "ticks" | "bars";
  replay_generation?: number;
  profile_version?: number;
  initial_cursor?: number;
  start_policy?: "random" | "specified" | "legacy";
  initial_balance?: number;
  currency?: "USD" | "USC" | "THB";
  target_trades?: number;
  goal?: string;
  point_value?: number;
};
export type Accounting = {
  initial_balance: number;
  currency: string;
  net_pnl: number;
  balance: number;
  floating_pnl: number;
  equity: number;
};
export type PositionDraft = {
  side: "BUY" | "SELL";
  order_type: "MARKET" | "LIMIT" | "STOP";
  entry: number;
  sl: number;
  tp: number;
  lot: number;
  time: number;
  end_time?: number;
};
export type PositionGeometry = {
  width: number;
  left: number;
  right: number;
  entry: number;
  sl: number;
  tp: number;
  height: number;
};
