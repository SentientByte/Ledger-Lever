import { invoke } from "@tauri-apps/api/core";
import type {
  DerivedPosition,
  PerformancePoint,
  Position,
  PortfolioSummary,
  TransactionPage,
  TransactionSummary,
  TransactionUploadResult,
  YearActivity,
} from "../types";

export const getSummary = () =>
  invoke<PortfolioSummary>("get_portfolio_summary");

export const getPositions = () =>
  invoke<Position[]>("get_positions");

export const addPosition = (symbol: string, shares: number, avg_cost: number) =>
  invoke<Position>("add_position", { symbol, shares, avgCost: avg_cost });

export const updatePosition = (id: number, shares?: number, avg_cost?: number) =>
  invoke<Position>("update_position", { id, shares, avgCost: avg_cost });

export const deletePosition = (id: number) =>
  invoke<void>("delete_position", { id });

export const getPerformance = (days = 30) =>
  invoke<PerformancePoint[]>("get_portfolio_performance", { days });

export const validateSymbol = (symbol: string) =>
  invoke<{ symbol: string; name: string; price: number }>("validate_symbol", { symbol });

export const manualRefresh = () =>
  invoke<void>("manual_refresh");

export const getMarketStatus = () =>
  invoke<{ is_open: boolean; refresh_interval_secs: number; et_time: string }>(
    "get_market_status"
  );

export const getTransactions = (params: {
  symbol?: string;
  side?: string;
  page?: number;
  page_size?: number;
}) =>
  invoke<TransactionPage>("get_transactions", {
    symbol: params.symbol ?? null,
    side: params.side ?? null,
    page: params.page ?? 1,
    pageSize: params.page_size ?? 10,
  });

export const getTransactionSymbols = () =>
  invoke<string[]>("get_transaction_symbols");

export const getDerivedPositions = () =>
  invoke<DerivedPosition[]>("get_derived_positions");

export const getTransactionSummary = () =>
  invoke<TransactionSummary>("get_transaction_summary");

export const getYearActivity = () =>
  invoke<YearActivity[]>("get_year_activity");

export const uploadTransactions = async (file: File): Promise<TransactionUploadResult> => {
  const csvContent = await file.text();
  return invoke<TransactionUploadResult>("upload_transactions", { csvContent });
};

export const resetTransactions = () =>
  invoke<TransactionUploadResult>("reset_transactions");

export const clearTransactions = () =>
  invoke<void>("clear_transactions");

export const getPriceBars = (symbols: string[], period = "2y") =>
  invoke<Record<string, { date: string; close: number }[]>>("get_price_bars", {
    symbols,
    period,
  });

// Legacy compatibility — some pages may reference getPriceHistory
export const getPriceHistory = (_symbol: string, _period = "3mo") =>
  Promise.resolve([]);
