import type { BarData } from "../types";
import { barsToReturns, barVol, stdDev, alignBarsReturns, corrCoef } from "./stats";

/* =============================================================================
   Monte-Carlo portfolio engine — ported from the standalone Outcome Dashboard
   and wired to the user's real holdings. Per-asset assumptions (μ, σ, β) are
   derived from the historical price bars already fetched, with category-based
   fallbacks; correlations come from realized daily returns. Geometric Brownian
   motion with Cholesky-correlated shocks plus a bubble-driven correction tail.
   ============================================================================= */

export type AssetCategory =
  | "usEquity"
  | "intlEquity"
  | "em"
  | "bond"
  | "tips"
  | "gold"
  | "cash";

export interface MacroState {
  rateShock: number; // [-2, 2]  positive = rate hikes
  macroSlowdown: number; // [0, 2]
  bubbleRisk: number; // [0, 1]
  oilShock: number; // [-2, 2]
  goldShock: number; // [-2, 2]
}

export interface SimAsset {
  symbol: string;
  name: string | null;
  category: AssetCategory;
  mu: number; // annual expected return (fraction)
  sigma: number; // annual volatility (fraction)
  beta: number; // vs S&P 500
  sourced: boolean; // true when σ/β came from real bars, false = fallback
}

export interface SimMetrics {
  mean: number;
  sigma: number;
  median: number;
  p25: number;
  p75: number;
  best: number;
  worst: number;
  var95: number;
  var99: number;
  cvar95: number;
  cvar99: number;
  sharpe: number;
  sortino: number;
  beta: number;
  probLoss: number;
  probSevereLoss: number;
  skew: number;
  kurt: number;
}

export interface HistBin {
  x0: number;
  x1: number;
  freq: number;
}

export interface SimResult {
  metrics: SimMetrics;
  hist: HistBin[];
  returns: Float64Array;
}

// ── Category classification (mirrors the Risk page's bucketing) ───────────────
export function classifySymbol(symbol: string, name: string | null): AssetCategory {
  const n = (name ?? symbol).toLowerCase();
  if (n.includes("sgov") || n.includes("t-bill") || n.includes("cash") || n.includes("money")) return "cash";
  if (n.includes("schp") || n.includes("tip")) return "tips";
  if (n.includes("iau") || n.includes("gold")) return "gold";
  if (n.includes("iemg") || n.includes("emerging")) return "em";
  if (n.includes("bnd") || n.includes("bond") || n.includes("agg") || n.includes("ief") || n.includes("treasury")) return "bond";
  if (n.includes("ixus") || n.includes("international") || n.includes("intl") || n.includes("developed")) return "intlEquity";
  return "usEquity";
}

// Long-run fallbacks when a symbol lacks enough bar history.
const CATEGORY_DEFAULTS: Record<AssetCategory, { sigma: number; beta: number }> = {
  usEquity:   { sigma: 0.17, beta: 1.0 },
  intlEquity: { sigma: 0.16, beta: 0.85 },
  em:         { sigma: 0.22, beta: 1.1 },
  bond:       { sigma: 0.06, beta: 0.1 },
  tips:       { sigma: 0.07, beta: 0.15 },
  gold:       { sigma: 0.15, beta: 0.2 },
  cash:       { sigma: 0.005, beta: 0.0 },
};

// Per-category macro sensitivities (sign conventions match applyMacro).
const CATEGORY_RISK: Record<AssetCategory, { rate: number; bubble: number; oil: number; gold: number }> = {
  usEquity:   { rate: 0.8,  bubble: 0.5,  oil: -0.05, gold: -0.08 },
  intlEquity: { rate: 0.6,  bubble: 0.3,  oil: 0.05,  gold: 0.0 },
  em:         { rate: 0.7,  bubble: 0.35, oil: 0.1,   gold: 0.05 },
  bond:       { rate: 1.2,  bubble: 0.0,  oil: -0.05, gold: 0.1 },
  tips:       { rate: 0.8,  bubble: 0.0,  oil: 0.1,   gold: 0.15 },
  gold:       { rate: 0.3,  bubble: 0.0,  oil: 0.1,   gold: 1.0 },
  cash:       { rate: -0.1, bubble: 0.0,  oil: 0.0,   gold: 0.0 },
};

/**
 * Build a SimAsset from real bars. σ from realized annualized vol, β from
 * regression vs SPY, μ from CAPM (riskFree + β·ERP) so the forward assumption is
 * principled rather than an overfit of trailing returns.
 */
export function buildSimAsset(
  symbol: string,
  name: string | null,
  bars: BarData[],
  spyBars: BarData[],
  riskFree: number,
  equityRiskPremium = 0.05
): SimAsset {
  const category = classifySymbol(symbol, name);
  const fallback = CATEGORY_DEFAULTS[category];

  const volPct = barVol(bars); // annualized %
  const sigma = volPct != null ? volPct / 100 : fallback.sigma;

  let beta = fallback.beta;
  let sourced = false;
  if (bars.length >= 20 && spyBars.length >= 20) {
    const [rAsset, rSpy] = alignBarsReturns(bars, spyBars);
    if (rSpy.length >= 20) {
      const varSpy = Math.pow(stdDev(rSpy), 2);
      if (varSpy > 0) {
        const meanA = rAsset.reduce((a, b) => a + b, 0) / rAsset.length;
        const meanS = rSpy.reduce((a, b) => a + b, 0) / rSpy.length;
        let cov = 0;
        for (let i = 0; i < rSpy.length; i++) cov += (rAsset[i] - meanA) * (rSpy[i] - meanS);
        cov /= rSpy.length - 1;
        beta = cov / varSpy;
        sourced = volPct != null;
      }
    }
  }

  const mu = riskFree + beta * equityRiskPremium;
  return { symbol, name, category, mu, sigma, beta, sourced };
}

/** Realized correlation matrix from bars, aligned by symbol order. */
export function correlationMatrix(symbols: string[], bars: Record<string, BarData[]>): number[][] {
  return symbols.map((a) =>
    symbols.map((b) => {
      if (a === b) return 1;
      const ba = bars[a] ?? [];
      const bb = bars[b] ?? [];
      if (ba.length < 20 || bb.length < 20) return 0;
      const [ra, rb] = alignBarsReturns(ba, bb);
      return corrCoef(ra, rb);
    })
  );
}

// ── Numerics ──────────────────────────────────────────────────────────────────
function cholesky(matrix: number[][]): number[][] {
  const n = matrix.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k];
      if (i === j) {
        L[i][j] = Math.sqrt(Math.max(matrix[i][i] - sum, 1e-10));
      } else {
        L[i][j] = (matrix[i][j] - sum) / (L[j][j] || 1e-10);
      }
    }
  }
  return L;
}

function makeRNG(seed: number) {
  let s = seed >>> 0 || 123456789;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 0) / 4294967296;
  };
}

function gaussianPair(rng: () => number): [number, number] {
  let u1 = rng();
  const u2 = rng();
  if (u1 < 1e-12) u1 = 1e-12;
  const r = Math.sqrt(-2 * Math.log(u1));
  return [r * Math.cos(2 * Math.PI * u2), r * Math.sin(2 * Math.PI * u2)];
}

function applyMacro(asset: SimAsset, macro: MacroState): { mu: number; sigma: number } {
  const ex = CATEGORY_RISK[asset.category];
  const muFromRates = -0.03 * macro.rateShock * ex.rate;
  const muFromMacro = -0.04 * macro.macroSlowdown * asset.beta;
  const muFromBubble = -0.1 * macro.bubbleRisk * ex.bubble;
  const muFromOil = 0.05 * macro.oilShock * ex.oil;
  const muFromGold = 0.04 * macro.goldShock * ex.gold;

  const sigmaFromBubble = asset.sigma * (1 + 0.6 * macro.bubbleRisk * ex.bubble);
  const sigmaFromMacro = asset.sigma * (1 + 0.15 * macro.macroSlowdown * (asset.beta / 1.5));
  const sigmaFromOil = asset.sigma * (1 + 0.08 * Math.abs(macro.oilShock) * Math.abs(ex.oil));

  const mu = asset.mu + muFromRates + muFromMacro + muFromBubble + muFromOil + muFromGold;
  const sigma = Math.max(
    0.005,
    sigmaFromBubble + (sigmaFromMacro - asset.sigma) + (sigmaFromOil - asset.sigma)
  );
  return { mu, sigma };
}

export function runMonteCarlo(params: {
  assets: SimAsset[];
  weights: number[]; // aligned with assets, need not sum to 1 (renormalized)
  corr: number[][];
  nSims: number;
  horizonYears: number;
  macro: MacroState;
  seed: number;
}): Float64Array | null {
  const { assets, weights, corr, nSims, horizonYears, macro, seed } = params;
  const n = assets.length;
  if (n === 0) return null;

  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  const w = weights.map((x) => x / wsum);

  const L = cholesky(corr);
  const rng = makeRNG(seed);
  const dt = horizonYears;
  const adj = assets.map((a) => applyMacro(a, macro));

  const tailProb = Math.min(0.35, 0.04 + 0.12 * macro.bubbleRisk);
  const tailSeverity = 0.18 + 0.12 * macro.bubbleRisk;

  const results = new Float64Array(nSims);
  for (let s = 0; s < nSims; s++) {
    const independent = new Array(n);
    for (let i = 0; i < n; i += 2) {
      const [g1, g2] = gaussianPair(rng);
      independent[i] = g1;
      if (i + 1 < n) independent[i + 1] = g2;
    }
    const z = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = 0; k <= i; k++) sum += L[i][k] * independent[k];
      z[i] = sum;
    }
    const isTail = rng() < tailProb;
    let ratio = 0;
    for (let i = 0; i < n; i++) {
      const { mu, sigma } = adj[i];
      const drift = isTail ? -tailSeverity * CATEGORY_RISK[assets[i].category].bubble : 0;
      const logRet = (mu - 0.5 * sigma * sigma) * dt + sigma * Math.sqrt(dt) * z[i] + drift;
      ratio += w[i] * Math.exp(logRet);
    }
    results[s] = ratio - 1;
  }
  return results;
}

function percentile(sorted: Float64Array, p: number): number {
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * sorted.length)));
  return sorted[idx];
}

export function computeMetrics(
  returns: Float64Array,
  portfolioBeta: number,
  riskFree: number
): SimMetrics {
  const n = returns.length;
  const sorted = Float64Array.from(returns).sort();
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const sigma = Math.sqrt(variance);
  const downside = Array.from(returns).filter((r) => r < 0);
  const downsideDev = Math.sqrt(downside.length ? downside.reduce((a, b) => a + b * b, 0) / downside.length : 0);
  const var95 = percentile(sorted, 0.05);
  const var99 = percentile(sorted, 0.01);
  const cvar95Arr = sorted.slice(0, Math.max(1, Math.floor(0.05 * n)));
  const cvar95 = cvar95Arr.reduce((a, b) => a + b, 0) / cvar95Arr.length;
  const cvar99Arr = sorted.slice(0, Math.max(1, Math.floor(0.01 * n)));
  const cvar99 = cvar99Arr.reduce((a, b) => a + b, 0) / cvar99Arr.length;
  const sharpe = sigma > 0 ? (mean - riskFree) / sigma : 0;
  const sortino = downsideDev > 0 ? (mean - riskFree) / downsideDev : 0;
  const probLoss = Array.from(returns).filter((r) => r < 0).length / n;
  const probSevereLoss = Array.from(returns).filter((r) => r < -0.2).length / n;
  const skew = sigma > 0 ? returns.reduce((a, b) => a + ((b - mean) / sigma) ** 3, 0) / n : 0;
  const kurt = sigma > 0 ? returns.reduce((a, b) => a + ((b - mean) / sigma) ** 4, 0) / n - 3 : 0;
  return {
    mean, sigma,
    median: percentile(sorted, 0.5),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    best: sorted[n - 1], worst: sorted[0],
    var95: -var95, var99: -var99, cvar95: -cvar95, cvar99: -cvar99,
    sharpe, sortino, beta: portfolioBeta, probLoss, probSevereLoss, skew, kurt,
  };
}

export function histogramData(returns: Float64Array, bins: number): HistBin[] {
  let min = Infinity, max = -Infinity;
  for (const r of returns) { if (r < min) min = r; if (r > max) max = r; }
  const width = (max - min) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const r of returns) {
    let idx = Math.floor((r - min) / width);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    counts[idx]++;
  }
  return counts.map((c, i) => ({ x0: min + i * width, x1: min + (i + 1) * width, freq: c / returns.length }));
}

/** Daily-return-derived realized annual μ (used only for display, not the sim). */
export function realizedAnnualReturn(bars: BarData[]): number | null {
  const rets = barsToReturns(bars);
  if (rets.length < 20) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  return mean * 252;
}
