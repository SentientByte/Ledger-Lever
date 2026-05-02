import type { PerformancePoint } from "../types";

export function dailyReturns(data: PerformancePoint[]): number[] {
  return data.slice(1).map((d, i) => {
    const prev = data[i].total_value;
    return prev > 0 ? (d.total_value - prev) / prev : 0;
  });
}

export function stdDev(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

/** Peak-to-trough max drawdown as a negative percentage (e.g. -7.4) */
export function maxDrawdownPct(data: PerformancePoint[]): number {
  if (data.length < 2) return 0;
  let peak = data[0].total_value;
  let maxDD = 0;
  for (const d of data) {
    if (d.total_value > peak) peak = d.total_value;
    const dd = peak > 0 ? (d.total_value - peak) / peak : 0;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD * 100;
}

/** Annualized return over the full data window, as a percentage. */
export function annualizedReturnPct(data: PerformancePoint[]): number | null {
  if (data.length < 2) return null;
  const first = data[0];
  const last = data[data.length - 1];
  const days =
    (new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) /
    86_400_000;
  if (days < 1 || first.total_value <= 0) return null;
  return (Math.pow(last.total_value / first.total_value, 365 / days) - 1) * 100;
}

/** Annualized Sharpe ratio. Requires ≥20 return observations. */
export function sharpeRatio(
  returns: number[],
  riskFreeAnnual = 0.05
): number | null {
  if (returns.length < 20) return null;
  const vol = stdDev(returns) * Math.sqrt(252);
  if (vol === 0) return null;
  const annReturn = (returns.reduce((a, b) => a + b, 0) / returns.length) * 252;
  return (annReturn - riskFreeAnnual) / vol;
}

/** Annualized Sortino ratio. */
export function sortinoRatio(
  returns: number[],
  riskFreeAnnual = 0.05
): number | null {
  if (returns.length < 20) return null;
  const downside = returns.filter((r) => r < 0);
  if (downside.length === 0) return null;
  const downDev = stdDev(downside) * Math.sqrt(252);
  if (downDev === 0) return null;
  const annReturn = (returns.reduce((a, b) => a + b, 0) / returns.length) * 252;
  return (annReturn - riskFreeAnnual) / downDev;
}

/** Historical VaR at given confidence level, as a percentage (negative). */
export function historicalVaR(
  returns: number[],
  level = 0.95
): number | null {
  if (returns.length < 20) return null;
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.floor(returns.length * (1 - level));
  return sorted[Math.max(0, idx)] * 100;
}

/** Historical CVaR (Expected Shortfall) as a percentage (negative). */
export function historicalCVaR(
  returns: number[],
  level = 0.95
): number | null {
  if (returns.length < 20) return null;
  const sorted = [...returns].sort((a, b) => a - b);
  const cutoff = Math.max(1, Math.floor(returns.length * (1 - level)));
  const tail = sorted.slice(0, cutoff);
  return (tail.reduce((a, b) => a + b, 0) / tail.length) * 100;
}

/** Annualized volatility as a percentage. */
export function annualizedVol(returns: number[]): number | null {
  if (returns.length < 20) return null;
  return stdDev(returns) * Math.sqrt(252) * 100;
}

/**
 * Monthly returns from a value time-series.
 * Returns last N months sorted oldest→newest.
 */
export function monthlyReturns(
  data: PerformancePoint[],
  maxMonths = 24
): { label: string; pct: number }[] {
  const byMonth: Record<string, { first: number; last: number }> = {};
  for (const d of data) {
    const dt = new Date(d.timestamp);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    if (!byMonth[key]) byMonth[key] = { first: d.total_value, last: d.total_value };
    else byMonth[key].last = d.total_value;
  }
  return Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-maxMonths)
    .map(([key, { first, last }]) => {
      const [y, m] = key.split("-");
      const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(
        "en-US",
        { month: "short", year: "2-digit" }
      );
      return { label, pct: first > 0 ? ((last - first) / first) * 100 : 0 };
    });
}

/**
 * Return % over a specific calendar period ending at the last data point.
 * period: "MTD" | "QTD" | "YTD"
 */
export function periodReturn(
  data: PerformancePoint[],
  period: "MTD" | "QTD" | "YTD"
): number | null {
  if (data.length < 2) return null;
  const last = data[data.length - 1];
  const now = new Date(last.timestamp);
  let startDate: Date;
  if (period === "MTD") {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === "QTD") {
    const qStart = Math.floor(now.getMonth() / 3) * 3;
    startDate = new Date(now.getFullYear(), qStart, 1);
  } else {
    startDate = new Date(now.getFullYear(), 0, 1);
  }
  // Find the closest data point on or just after startDate
  const startPt = data.find((d) => new Date(d.timestamp) >= startDate);
  if (!startPt || startPt.total_value === 0) return null;
  return ((last.total_value - startPt.total_value) / startPt.total_value) * 100;
}

/** Calmar ratio = annualized return / |max drawdown| */
export function calmarRatio(data: PerformancePoint[]): number | null {
  const annRet = annualizedReturnPct(data);
  const dd = maxDrawdownPct(data);
  if (annRet === null || dd === 0) return null;
  return annRet / Math.abs(dd);
}
