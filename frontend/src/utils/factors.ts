import type { Position, BarsResult, BarData } from "../types";
import { stdDev } from "./stats";

/* =============================================================================
   Live factor exposures & stress tests.

   Both are computed from the historical price bars already fetched (2-yr daily),
   not from hardcoded constants:

   • Factor exposures — standardized multivariate (ridge) regression of the
     portfolio's daily returns on factor-mimicking ETF portfolios built from the
     instruments we have bars for (market, growth, intl, EM, duration, credit,
     inflation, low-vol, gold). Loadings are standardized betas (≈ partial
     correlations), comparable across factors.

   • Stress tests — a two-factor (equity SPY + duration IEF) regression gives the
     portfolio's live betas; each scenario is then a pair of historical index
     shocks applied through those live betas. Parametric σ-shocks use the
     portfolio's own realized volatility. Nothing is per-asset hardcoded.
   ============================================================================= */

const MIN_OBS = 30;

/** date -> simple daily return for a bar series. */
function retByDate(bars: BarData[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    if (prev > 0) m.set(bars[i].date, (bars[i].close - prev) / prev);
  }
  return m;
}

/** Market-value-weighted portfolio daily returns, renormalized over covered weight. */
function portfolioReturns(
  positions: Position[],
  barsData: BarsResult
): Map<string, number> {
  const totalMV = positions.reduce((s, p) => s + (p.market_value ?? 0), 0) || 1;
  const legs = positions
    .map((p) => ({
      w: (p.market_value ?? 0) / totalMV,
      r: retByDate(barsData[p.symbol.toUpperCase()] ?? []),
    }))
    .filter((l) => l.w > 0 && l.r.size > 0);

  // Union of all dates, weighted average over holdings present each day.
  const dates = new Set<string>();
  for (const l of legs) for (const d of l.r.keys()) dates.add(d);

  const out = new Map<string, number>();
  for (const d of dates) {
    let acc = 0;
    let covered = 0;
    for (const l of legs) {
      const r = l.r.get(d);
      if (r !== undefined) {
        acc += l.w * r;
        covered += l.w;
      }
    }
    // Require at least half the portfolio priced that day to keep the point.
    if (covered >= 0.5) out.set(d, acc / covered);
  }
  return out;
}

/** Combine ETF legs (e.g. QQQ − SPY) into a single factor return series. */
function factorReturns(
  legs: [string, number][],
  barsData: BarsResult
): Map<string, number> | null {
  const series = legs.map(([sym, sign]) => ({
    sign,
    r: retByDate(barsData[sym.toUpperCase()] ?? []),
  }));
  if (series.some((s) => s.r.size === 0)) return null;
  // Dates present in the first leg; require all legs present.
  const out = new Map<string, number>();
  for (const d of series[0].r.keys()) {
    let v = 0;
    let ok = true;
    for (const s of series) {
      const r = s.r.get(d);
      if (r === undefined) { ok = false; break; }
      v += s.sign * r;
    }
    if (ok) out.set(d, v);
  }
  return out.size > 0 ? out : null;
}

// ── Solve a symmetric linear system via Gaussian elimination (partial pivot) ──
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  // Gauss-Jordan complete: M is diagonal in its first n columns.
  const x = new Array(n);
  for (let i = 0; i < n; i++) x[i] = M[i][n] / M[i][i];
  return x;
}

/** Ridge regression coefficients (no intercept column appended here). */
function ridge(X: number[][], y: number[], lambda: number): number[] | null {
  const n = X.length;
  const k = X[0]?.length ?? 0;
  if (n === 0 || k === 0) return null;
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  for (let a = 0; a < k; a++) XtX[a][a] += lambda;
  return solve(XtX, Xty);
}

export interface FactorLoading {
  name: string;
  value: number; // standardized loading (≈ −1…+1)
  note: string;
  dir: number;
}

const FACTOR_SPECS: { name: string; note: string; legs: [string, number][] }[] = [
  { name: "Market (β)",     note: "vs S&P 500 (SPY)",   legs: [["SPY", 1]] },
  { name: "Tech / Growth",  note: "QQQ − SPY",          legs: [["QQQ", 1], ["SPY", -1]] },
  { name: "International",   note: "IXUS − SPY",         legs: [["IXUS", 1], ["SPY", -1]] },
  { name: "Emerging Mkts",  note: "IEMG − SPY",         legs: [["IEMG", 1], ["SPY", -1]] },
  { name: "Term / Duration", note: "IEF (7–10y UST)",   legs: [["IEF", 1]] },
  { name: "Credit (DEF)",   note: "AGG − IEF",          legs: [["AGG", 1], ["IEF", -1]] },
  { name: "Inflation (BEI)", note: "SCHP − IEF",        legs: [["SCHP", 1], ["IEF", -1]] },
  { name: "Low Volatility", note: "USMV − SPY",         legs: [["USMV", 1], ["SPY", -1]] },
  { name: "Gold / Real",    note: "IAU",                legs: [["IAU", 1]] },
];

/**
 * Standardized multivariate factor loadings from realized daily returns.
 * Returns null if there isn't enough overlapping history to regress.
 */
export function computeFactorExposures(
  positions: Position[],
  barsData: BarsResult
): { factors: FactorLoading[]; n: number } | null {
  if (positions.length === 0) return null;
  const portRet = portfolioReturns(positions, barsData);
  if (portRet.size < MIN_OBS) return null;

  const specs = FACTOR_SPECS.map((s) => ({ spec: s, ret: factorReturns(s.legs, barsData) }))
    .filter((x) => x.ret !== null) as { spec: typeof FACTOR_SPECS[number]; ret: Map<string, number> }[];
  if (specs.length === 0) return null;

  // Common dates across portfolio + all factors.
  let common: string[] = [...portRet.keys()];
  for (const s of specs) common = common.filter((d) => s.ret.has(d));
  common.sort();
  if (common.length < MIN_OBS) return null;

  // Standardize y and each factor column (z-scores).
  const yRaw = common.map((d) => portRet.get(d)!);
  const yMean = yRaw.reduce((a, b) => a + b, 0) / yRaw.length;
  const ySd = stdDev(yRaw) || 1;
  const y = yRaw.map((v) => (v - yMean) / ySd);

  const cols = specs.map((s) => {
    const raw = common.map((d) => s.ret.get(d)!);
    const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
    const sd = stdDev(raw) || 1;
    return raw.map((v) => (v - mean) / sd);
  });
  const X = common.map((_, i) => cols.map((c) => c[i]));

  const coefs = ridge(X, y, 0.5);
  if (!coefs) return null;

  const factors: FactorLoading[] = specs.map((s, i) => ({
    name: s.spec.name,
    note: s.spec.note,
    value: coefs[i],
    dir: coefs[i] >= 0 ? 1 : -1,
  }));
  return { factors, n: common.length };
}

// ── Stress tests ──────────────────────────────────────────────────────────────
export interface StressRow {
  scenario: string;
  period: string;
  portfolio: number; // %
  bench6040: number; // %
  spy: number; // %
}

// Each scenario = a pair of historical index shocks (SPY, IEF) in %, applied
// through the portfolio's live betas. Magnitudes are real index moves, not
// per-asset estimates.
const SHOCK_SCENARIOS: { scenario: string; period: string; spy: number; ief: number }[] = [
  { scenario: "2008 Financial Crisis", period: "Oct 07 – Mar 09 · SPY −57 / UST +14", spy: -56.8, ief: 14.0 },
  { scenario: "2020 Covid Crash",      period: "Feb–Mar 20 · SPY −34 / UST +6",       spy: -33.9, ief: 6.0 },
  { scenario: "2022 Rate Shock",       period: "Jan–Oct 22 · SPY −25 / UST −15",      spy: -25.4, ief: -15.5 },
  { scenario: "Stagflation (sim)",     period: "+200bps CPI · SPY −22 / UST −12",     spy: -22.0, ief: -12.0 },
  { scenario: "EM Currency Crisis",    period: "EM −30%, USD +12% · SPY −8 / UST +3", spy: -8.2, ief: 3.0 },
];

/**
 * Live two-factor (SPY, IEF) stress test. Returns null without enough history.
 */
export function computeStressTests(
  positions: Position[],
  barsData: BarsResult
): { rows: StressRow[]; betaSPY: number; betaIEF: number; n: number } | null {
  if (positions.length === 0) return null;
  const portRet = portfolioReturns(positions, barsData);
  const spyRet = retByDate(barsData["SPY"] ?? []);
  const iefRet = retByDate(barsData["IEF"] ?? []);
  if (portRet.size < MIN_OBS || spyRet.size < MIN_OBS || iefRet.size < MIN_OBS) return null;

  const common = [...portRet.keys()].filter((d) => spyRet.has(d) && iefRet.has(d)).sort();
  if (common.length < MIN_OBS) return null;

  const y = common.map((d) => portRet.get(d)!);
  const X = common.map((d) => [spyRet.get(d)!, iefRet.get(d)!]);
  // Regress with intercept so a non-zero mean drift doesn't leak into betas.
  const Xi = X.map((row) => [1, ...row]);
  const coefs = ridge(Xi, y, 1e-6);
  if (!coefs) return null;
  const betaSPY = coefs[1];
  const betaIEF = coefs[2];

  const rows: StressRow[] = SHOCK_SCENARIOS.map((s) => ({
    scenario: s.scenario,
    period: s.period,
    portfolio: betaSPY * s.spy + betaIEF * s.ief,
    bench6040: 0.6 * s.spy + 0.4 * s.ief,
    spy: s.spy,
  }));

  // Parametric live σ-shock (21-trading-day, scaled from realized daily vol).
  const monthly = Math.sqrt(21);
  const portSigmaM = stdDev(y) * monthly * 100;
  const spySigmaM = stdDev(common.map((d) => spyRet.get(d)!)) * monthly * 100;
  const iefSigmaM = stdDev(common.map((d) => iefRet.get(d)!)) * monthly * 100;
  rows.push({
    scenario: "−3σ Tail (live)",
    period: "Parametric · 21-day · realized σ",
    portfolio: -3 * portSigmaM,
    bench6040: -3 * (0.6 * spySigmaM + 0.4 * iefSigmaM),
    spy: -3 * spySigmaM,
  });

  return { rows, betaSPY, betaIEF, n: common.length };
}
