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
