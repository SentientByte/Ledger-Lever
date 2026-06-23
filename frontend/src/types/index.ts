export interface Position {
  id: number;
  symbol: string;
  name: string | null;
  shares: number;
  avg_cost: number;
  current_price: number | null;
  prev_close: number | null;
  market_value: number | null;
  cost_basis: number;
  total_gain: number | null;
  total_gain_pct: number | null;
  day_gain: number | null;
  day_gain_pct: number | null;
  day_high: number | null;
  day_low: number | null;
  volume: number | null;
  created_at: string;
}

export interface PortfolioSummary {
  total_value: number;
  total_cost: number;
  total_gain: number;
  total_gain_pct: number;
  day_gain: number;
  day_gain_pct: number;
  positions_count: number;
  last_updated: string | null;
}

export interface PerformancePoint {
  timestamp: string;
  total_value: number;
  total_cost: number;
}

export interface PriceHistoryPoint {
  timestamp: string;
  price: number;
}

export interface PositionCreate {
  symbol: string;
  shares: number;
  avg_cost: number;
}

export interface PositionUpdate {
  shares?: number;
  avg_cost?: number;
}

export interface Transaction {
  id: number;
  symbol: string;
  listing_exchange: string | null;
  dt: string;
  quantity: number;
  price: number;
  commission: number;
  side: "BUY" | "SELL";
  notional: number;
  net: number;
}

export interface TransactionPage {
  items: Transaction[];
  total: number;
  page: number;
  page_size: number;
}

export interface DerivedPosition {
  symbol: string;
  quantity: number;
  avg_cost: number;
  cost_basis: number;
  current_price: number | null;
  market_value: number | null;
  unrealized: number | null;
  unrealized_pct: number | null;
  weight_pct: number | null;
  first_lot_date: string;
}

export interface TransactionSummary {
  fills: number;
  invested: number;
  realized: number;
  unrealized: number | null;
  active_positions: number;
  last_fill: string | null;
  filename: string | null;
}

export interface TransactionUploadResult {
  added: number;
  duplicates: number;
  errors: number;
  total_rows: number;
}

export interface YearActivity {
  year: number;
  notional: number;
  buys: number;
  sells: number;
}

export interface BarData {
  date: string;
  close: number;
}

export interface MarketStatus {
  is_open: boolean;
  refresh_interval_secs: number;
  et_time: string;
}

export type BarsResult = Record<string, BarData[]>;
