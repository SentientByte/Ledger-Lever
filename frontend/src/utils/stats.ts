import type { PerformancePoint, BarData } from "../types";

// ── Trading-calendar cleaning ─────────────────────────────────────────────────

/** Day-of-week (0=Sun … 6=Sat) for a "YYYY-MM-DD" string, timezone-independent. */
function dowOf(dateStr: string): number {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Normalize a raw portfolio-value series into a clean daily trading-day series:
 *
 *  1. Collapse to one point per calendar day (latest snapshot wins).
 *  2. Drop weekend dates — the market is closed, so any weekend point is a
 *     reconstruction artifact.
 *  3. De-spike partial-coverage dips: if a holding is briefly missing a price
 *     (a cross-exchange holiday or a data gap) its value collapses for a single
 *     day and snaps back the next. Such a point shows a value/cost ratio that
 *     deviates sharply from both neighbours while the neighbours agree with each
 *     other; we restore it to the neighbour-interpolated level.
 *
 * Holidays carry no snapshot to begin with, so they simply never appear — which
 * is what "remove the days where exchanges were on a holiday or weekends" asks
 * for. The result is the IBKR-style daily valuation series.
 */
export function cleanPerfSeries(
  data: PerformancePoint[],
  spikeThreshold = 0.05
): PerformancePoint[] {
  if (data.length === 0) return [];

  const byDay = new Map<string, PerformancePoint>();
  for (const p of data) {
    const day = p.timestamp.slice(0, 10);
    const existing = byDay.get(day);
    if (!existing || p.timestamp > existing.timestamp) byDay.set(day, p);
  }

  let pts = [...byDay.values()]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .filter((p) => {
      const dow = dowOf(p.timestamp);
      return dow !== 0 && dow !== 6;
    });

  const ratio = (p: PerformancePoint) =>
    p.total_cost > 0 ? p.total_value / p.total_cost : p.total_value;

  const out = pts.map((p) => ({ ...p }));
  for (let i = 1; i < out.length - 1; i++) {
    const r = ratio(out[i]);
    const rPrev = ratio(out[i - 1]);
    const rNext = ratio(out[i + 1]);
    if (rPrev <= 0 || rNext <= 0) continue;
    const neighbor = (rPrev + rNext) / 2;
    const neighborsAgree =
      Math.abs(rPrev - rNext) / neighbor < spikeThreshold;
    const pointDeviates = Math.abs(r - neighbor) / neighbor > spikeThreshold;
    if (neighborsAgree && pointDeviates && out[i].total_cost > 0) {
      out[i] = { ...out[i], total_value: neighbor * out[i].total_cost };
    }
  }
  return out;
}

/**
 * Slice the trailing `months` of a (cleaned) daily series. The base point is the
 * last observation on/before the cutoff so the windowed return is measured in
 * full from the window's opening level.
 */
export function trailingMonths(
  data: PerformancePoint[],
  months: number
): PerformancePoint[] {
  if (data.length === 0) return [];
  const lastStr = data[data.length - 1].timestamp.slice(0, 10);
  const [y, m, d] = lastStr.split("-").map(Number);
  const cutoff = new Date(Date.UTC(y, m - 1 - months, d));
  const cutStr = cutoff.toISOString().slice(0, 10);
  let startI = 0;
  let foundBase = false;
  for (let i = 0; i < data.length; i++) {
    if (data[i].timestamp.slice(0, 10) <= cutStr) {
      startI = i;
      foundBase = true;
    } else {
      break;
    }
  }
  // If every point is inside the window, start at the first point.
  return data.slice(foundBase ? startI : 0);
}

/** Last bar close on or before `date` (forward-fill lookup); null if none. */
export function barValueOnOrBefore(bars: BarData[], date: string): number | null {
  let best: number | null = null;
  for (const b of bars) {
    if (b.date <= date) best = b.close;
    else break;
  }
  return best;
}

/**
 * Daily time-weighted returns.
 *
 * The portfolio value series is contaminated by external cash flows (buys add
 * money, sells remove it). The day-over-day change in `total_cost` (cost basis)
 * is the external flow for that day, so we strip it out before computing the
 * return — the same time-weighted approach IBKR uses for portfolio performance.
 */
export function dailyReturns(data: PerformancePoint[]): number[] {
  return data.slice(1).map((d, i) => {
    const prev = data[i].total_value;
    const flow = (d.total_cost ?? 0) - (data[i].total_cost ?? 0);
    return prev > 0 ? (d.total_value - flow - prev) / prev : 0;
  });
}

/**
 * Cumulative time-weighted return index, based at 100 on the first point.
 * Aligned 1:1 with `data` (same length). This is the IBKR-style portfolio
 * performance curve: external contributions/withdrawals are removed so the
 * line reflects investment performance only, not deposits.
 */
export function twrIndex(data: PerformancePoint[]): number[] {
  if (data.length === 0) return [];
  const idx = [100];
  for (let i = 1; i < data.length; i++) {
    const v0 = data[i - 1].total_value;
    const flow = (data[i].total_cost ?? 0) - (data[i - 1].total_cost ?? 0);
    const r = v0 > 0 ? (data[i].total_value - flow - v0) / v0 : 0;
    idx.push(idx[i - 1] * (1 + r));
  }
  return idx;
}

/** Time-weighted total return over the full window, as a percentage. */
export function twrTotalReturnPct(data: PerformancePoint[]): number | null {
  if (data.length < 2) return null;
  const idx = twrIndex(data);
  const base = idx[0];
  if (!(base > 0)) return null;
  return (idx[idx.length - 1] / base - 1) * 100;
}

export function stdDev(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

/**
 * Peak-to-trough max drawdown as a negative percentage (e.g. -7.4).
 * Computed on the time-weighted index so contributions don't masquerade as
 * recoveries (and withdrawals don't masquerade as drawdowns).
 */
export function maxDrawdownPct(data: PerformancePoint[]): number {
  if (data.length < 2) return 0;
  const idx = twrIndex(data);
  let peak = idx[0];
  let maxDD = 0;
  for (const v of idx) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (v - peak) / peak : 0;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD * 100;
}

/** Annualized time-weighted return over the full data window, as a percentage. */
export function annualizedReturnPct(data: PerformancePoint[]): number | null {
  if (data.length < 2) return null;
  const first = data[0];
  const last = data[data.length - 1];
  const days =
    (new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) /
    86_400_000;
  if (days < 1) return null;
  const idx = twrIndex(data);
  const growth = idx[0] > 0 ? idx[idx.length - 1] / idx[0] : 0;
  if (!(growth > 0)) return null;
  return (Math.pow(growth, 365 / days) - 1) * 100;
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
  if (data.length < 2) return [];
  // Time-weighted index so within-month flows don't distort the monthly return.
  const idx = twrIndex(data);
  const byMonth: Record<string, { first: number; last: number }> = {};
  data.forEach((d, i) => {
    const dt = new Date(d.timestamp);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    if (!byMonth[key]) byMonth[key] = { first: idx[i], last: idx[i] };
    else byMonth[key].last = idx[i];
  });
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
  const idx = twrIndex(data);
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
  // Anchor on the last point *before* the period starts so the period's own
  // return is measured in full; fall back to the first in-period point.
  let startI = -1;
  for (let i = 0; i < data.length; i++) {
    if (new Date(data[i].timestamp) < startDate) startI = i;
    else break;
  }
  if (startI < 0) startI = data.findIndex((d) => new Date(d.timestamp) >= startDate);
  if (startI < 0 || !(idx[startI] > 0)) return null;
  return (idx[idx.length - 1] / idx[startI] - 1) * 100;
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

/** Fallback long-run annualized volatility (%) when bar data is insufficient. */
export const SYMBOL_VOL_FALLBACK: Record<string, number> = {
  VTI: 17.2, IXUS: 16.1, IEMG: 22.0, BND: 5.8, IEF: 8.5,
  SCHP: 7.2, USMV: 12.8, IAU: 15.4, SGOV: 0.5,
};

/**
 * Portfolio annualized volatility as the market-value-weighted average of each
 * holding's realized ticker volatility (from price bars, or a fallback). This
 * reflects the volatility of the invested assets — unlike a vol computed from
 * the portfolio cash-value series, which is distorted by deposits/withdrawals.
 */
export function weightedAnnVol(
  positions: { symbol: string; market_value: number | null }[],
  bars: Record<string, BarData[]>
): number | null {
  let totalMV = 0;
  for (const p of positions) totalMV += p.market_value ?? 0;
  if (totalMV <= 0) return null;

  let acc = 0;
  let coveredWeight = 0;
  for (const p of positions) {
    const mv = p.market_value ?? 0;
    if (mv <= 0) continue;
    const sym = p.symbol.toUpperCase();
    const sigma = barVol(bars[sym] ?? []) ?? SYMBOL_VOL_FALLBACK[sym];
    if (sigma == null) continue;
    const w = mv / totalMV;
    acc += w * sigma;
    coveredWeight += w;
  }
  // Renormalize over the weight we could actually measure.
  return coveredWeight > 0 ? acc / coveredWeight : null;
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
