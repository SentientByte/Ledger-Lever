import type { PerformancePoint, BarData } from "../types";

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

// ── Bar-based utilities (historical price bars) ───────────────────────────────

/** Compute daily log returns from an array of BarData. */
export function barsToReturns(bars: BarData[]): number[] {
  if (bars.length < 2) return [];
  return bars.slice(1).map((b, i) => {
    const prev = bars[i].close;
    return prev > 0 ? (b.close - prev) / prev : 0;
  });
}

/** Annualized volatility (%) from bar data. Requires ≥20 bars. */
export function barVol(bars: BarData[]): number | null {
  const rets = barsToReturns(bars);
  if (rets.length < 20) return null;
  return stdDev(rets) * Math.sqrt(252) * 100;
}

/** Pearson correlation between two return series aligned by length. */
export function corrCoef(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const as = a.slice(-n);
  const bs = b.slice(-n);
  const ma = as.reduce((s, v) => s + v, 0) / n;
  const mb = bs.reduce((s, v) => s + v, 0) / n;
  let cov = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) {
    cov += (as[i] - ma) * (bs[i] - mb);
    sa += (as[i] - ma) ** 2;
    sb += (bs[i] - mb) ** 2;
  }
  const denom = Math.sqrt(sa * sb);
  return denom > 0 ? cov / denom : 0;
}

/**
 * Align two bar arrays by date, returning matched pairs.
 * Returns arrays of returns for the overlapping date range.
 */
export function alignBarsReturns(barsA: BarData[], barsB: BarData[]): [number[], number[]] {
  const mapB = new Map(barsB.map((b) => [b.date, b.close]));
  const paired: [number, number][] = [];
  for (let i = 1; i < barsA.length; i++) {
    const dateA = barsA[i].date;
    const datePrevA = barsA[i - 1].date;
    const closeB = mapB.get(dateA);
    const closePrevB = mapB.get(datePrevA);
    if (closeB != null && closePrevB != null && closePrevB > 0 && barsA[i - 1].close > 0) {
      paired.push([
        (barsA[i].close - barsA[i - 1].close) / barsA[i - 1].close,
        (closeB - closePrevB) / closePrevB,
      ]);
    }
  }
  return [paired.map((p) => p[0]), paired.map((p) => p[1])];
}

/**
 * Index bars to 100 starting from the first bar on or after refDate.
 * Returns an array of { date, value } ready for charting.
 */
export function indexBars(bars: BarData[], refDate: string): { date: string; value: number }[] {
  const start = bars.findIndex((b) => b.date >= refDate);
  if (start < 0) return [];
  const base = bars[start].close;
  if (base <= 0) return [];
  return bars.slice(start).map((b) => ({ date: b.date, value: (b.close / base) * 100 }));
}

/** Period return (MTD/QTD/YTD) from bar data, as a percentage. */
export function barPeriodReturn(bars: BarData[], period: "MTD" | "QTD" | "YTD"): number | null {
  if (bars.length < 2) return null;
  const last = bars[bars.length - 1];
  const now = new Date(last.date);
  let startDate: Date;
  if (period === "MTD") {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === "QTD") {
    const qStart = Math.floor(now.getMonth() / 3) * 3;
    startDate = new Date(now.getFullYear(), qStart, 1);
  } else {
    startDate = new Date(now.getFullYear(), 0, 1);
  }
  const startStr = startDate.toISOString().slice(0, 10);
  const startBar = bars.find((b) => b.date >= startStr);
  if (!startBar || startBar.close <= 0) return null;
  return ((last.close - startBar.close) / startBar.close) * 100;
}
