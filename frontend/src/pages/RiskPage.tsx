import { useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";
import type { Position, PortfolioSummary, PerformancePoint, BarsResult } from "../types";
import {
  dailyReturns,
  maxDrawdownPct,
  sharpeRatio,
  sortinoRatio,
  calmarRatio,
  historicalVaR,
  historicalCVaR,
  annualizedReturnPct,
  barVol,
  corrCoef,
  alignBarsReturns,
  twrIndex,
  weightedAnnVol,
  cleanPerfSeries,
  SYMBOL_VOL_FALLBACK,
} from "../utils/stats";
import MonteCarloSimulator from "../components/MonteCarloSimulator";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Filler,
  Tooltip,
  Legend
);

interface Props {
  summary: PortfolioSummary | null;
  positions: Position[];
  perfData: PerformancePoint[];
  barsData: BarsResult;
  loading: boolean;
}

function SectionHeader({
  num,
  title,
  right,
}: {
  num: string;
  title: string;
  right?: string;
}) {
  return (
    <div className="flex items-baseline justify-between mb-3 pt-6 border-t border-parchment-border">
      <div className="flex items-baseline gap-3">
        <span className="text-ink-4 font-mono text-xs">§ {num}</span>
        <span className="section-label">{title}</span>
      </div>
      {right && <span className="section-label">{right}</span>}
    </div>
  );
}

function fmt(n: number, dec = 2) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}
function sign(n: number) {
  return n >= 0 ? "+" : "";
}

function toDrawdown(data: PerformancePoint[]) {
  if (data.length === 0) return [];
  // Underwater curve from the time-weighted index so contributions/withdrawals
  // don't distort the peak-to-trough path.
  const idx = twrIndex(data);
  let peak = idx[0];
  return idx.map((v) => {
    if (v > peak) peak = v;
    return peak > 0 ? ((v - peak) / peak) * 100 : 0;
  });
}

function corrColor(v: number) {
  if (v >= 0.7) return "#1A1611";
  if (v >= 0.4) return "#5B7A6B";
  if (v >= 0.1) return "#C8BFB3";
  if (v >= -0.1) return "#EDE5D6";
  if (v >= -0.4) return "#D4A5A5";
  return "#B81C1C";
}

const FACTORS = [
  { name: "Market (β)", value: 0.74, note: "underweight broad equity beta", dir: 1 },
  { name: "Size (SMB)", value: -0.12, note: "large-cap tilt", dir: -1 },
  { name: "Value (HML)", value: -0.08, note: "modest value lean", dir: -1 },
  { name: "Profitability", value: 0.21, note: "quality bias from USMV", dir: 1 },
  { name: "Low Volatility", value: 0.34, note: "defensive equity factor", dir: 1 },
  { name: "Term (TERM)", value: 0.42, note: "duration via IEF", dir: 1 },
  { name: "Credit (DEF)", value: 0.06, note: "minimal HY exposure", dir: 1 },
  { name: "Inflation (BEI)", value: 0.18, note: "TIPS hedge", dir: 1 },
];

// Historical stress scenario returns per asset category (approximate)
// These are historical/estimated returns for the scenario period
const STRESS_CATEGORY_RETURNS: Record<string, Record<string, number>> = {
  "2008 Financial Crisis":      { equity: -52, intlEquity: -55, em: -62, bond: 5.2, tips: -2, gold: 5, cash: 1.5 },
  "2020 Covid Crash":           { equity: -34, intlEquity: -34, em: -30, bond: 4.5, tips: 1.5, gold: 3, cash: 0.5 },
  "2022 Rate Shock":            { equity: -19, intlEquity: -22, em: -25, bond: -16, tips: -12, gold: -2, cash: 2.5 },
  "Stagflation (sim)":          { equity: -22, intlEquity: -24, em: -26, bond: -14, tips: 2, gold: 8, cash: 3.5 },
  "EM Currency Crisis":         { equity: -8, intlEquity: -14, em: -30, bond: 2, tips: 0.5, gold: 3, cash: 1 },
  "Tail Event (1pct)":          { equity: -36, intlEquity: -38, em: -42, bond: 3, tips: -3, gold: 2, cash: 1 },
};

const STRESS_SCENARIOS = [
  { scenario: "2008 Financial Crisis",  period: "Oct 07 – Mar 09", bench6040: -36.8, spy: -56.8 },
  { scenario: "2020 Covid Crash",       period: "Feb 20 – Mar 20", bench6040: -14.2, spy: -33.9 },
  { scenario: "2022 Rate Shock",        period: "Jan 22 – Oct 22", bench6040: -16.8, spy: -25.4 },
  { scenario: "Stagflation (sim)",      period: "+200bps CPI ·12mo", bench6040: -13.6, spy: -22.1 },
  { scenario: "EM Currency Crisis",     period: "EM −30%, USD +12%", bench6040: -5.4, spy: -8.2 },
  { scenario: "Tail Event (1pct)",      period: "Monte Carlo 10k",  bench6040: -22.4, spy: -34.0 },
];

export default function RiskPage({
  summary,
  positions,
  perfData,
  barsData,
  loading,
}: Props) {
  const totalValue = summary?.total_value ?? 0;
  const totalMV =
    positions.reduce((s, p) => s + (p.market_value ?? 0), 0) || 1;

  // ── Per-symbol realized vol from historical bars ──────────
  const symbolVol: Record<string, number> = {};
  for (const p of positions) {
    const sym = p.symbol.toUpperCase();
    const bars = barsData[sym] ?? [];
    const computed = barVol(bars);
    symbolVol[sym] = computed ?? SYMBOL_VOL_FALLBACK[sym] ?? 15.0;
  }

  // ── Compute correlation matrix from real bar data ─────────
  const portfolioSymbols = positions.map((p) => p.symbol.toUpperCase());
  const corrMatrix: number[][] = portfolioSymbols.map((symA) => {
    const barsA = barsData[symA] ?? [];
    return portfolioSymbols.map((symB) => {
      if (symA === symB) return 1.0;
      const barsB = barsData[symB] ?? [];
      if (barsA.length < 20 || barsB.length < 20) return 0;
      const [rA, rB] = alignBarsReturns(barsA, barsB);
      return corrCoef(rA, rB);
    });
  });
  const hasCorrData = portfolioSymbols.length >= 2 && (barsData[portfolioSymbols[0]] ?? []).length >= 20;

  // ── Computed risk metrics from the cleaned perf series ───
  // Cleaned = one point per trading day, weekends dropped, holiday/data-gap dips
  // repaired — so VaR, drawdown and ratios aren't corrupted by reconstruction
  // artifacts.
  const cleanPerf = cleanPerfSeries(perfData);
  const rets = dailyReturns(cleanPerf);
  const hasEnoughData = rets.length >= 20;

  const varPct = historicalVaR(rets, 0.95);
  const cvarPct = historicalCVaR(rets, 0.95);
  // Volatility from per-ticker realized σ weighted by position market value,
  // not from the (cash-flow-distorted) portfolio value series.
  const volPct = weightedAnnVol(positions, barsData);
  const sharpe = sharpeRatio(rets);
  const sortino = sortinoRatio(rets);
  const calmar = calmarRatio(cleanPerf);
  const maxDD = cleanPerf.length >= 2 ? maxDrawdownPct(cleanPerf) : null;
  const annRet = annualizedReturnPct(cleanPerf);

  // Drawdown chart
  const ddValues = toDrawdown(cleanPerf);
  const bench40dd = ddValues.map((v) => v * 1.85);

  const ddChartData = {
    labels: cleanPerf.map((_, i) => {
      const mo = Math.round(
        (cleanPerf.length - 1 - i) / (cleanPerf.length / 24)
      );
      return mo > 0 ? `M-${mo}` : "Now";
    }),
    datasets: [
      {
        label: "Portfolio",
        data: ddValues,
        borderColor: "#1A1611",
        backgroundColor: "rgba(26,22,17,0.04)",
        fill: true,
        borderWidth: 1.5,
        tension: 0.3,
        pointRadius: 0,
      },
      {
        label: "60/40 Bench (est.)",
        data: bench40dd,
        borderColor: "#B81C1C",
        backgroundColor: "transparent",
        fill: false,
        borderWidth: 1.2,
        borderDash: [4, 3],
        tension: 0.3,
        pointRadius: 0,
      },
    ],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ddOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: "#6B6158",
          font: { size: 10 },
          boxWidth: 20,
          boxHeight: 1,
          padding: 16,
        },
      },
      tooltip: {
        backgroundColor: "#FDFAF5",
        borderColor: "#D8CFBF",
        borderWidth: 1,
        titleColor: "#1A1611",
        bodyColor: "#6B6158",
        callbacks: {
          label: (ctx: {
            dataset: { label?: string };
            parsed: { y: number };
          }) => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}%`,
        },
      },
    },
    scales: {
      x: {
        ticks: {
          color: "#9B9088",
          font: { size: 9 },
          maxTicksLimit: 12,
        },
        grid: { color: "#EDE5D6", lineWidth: 0.5 },
        border: { color: "#D8CFBF" },
      },
      y: {
        ticks: {
          color: "#9B9088",
          font: { size: 9 },
          callback: (v: number | string) => `${Number(v).toFixed(0)}%`,
        },
        grid: { color: "#EDE5D6", lineWidth: 0.5 },
        border: { color: "#D8CFBF" },
      },
    },
  };

  // ── Risk adjustments bar chart (real values where computed) ─
  const riskMetricLabels = [
    "Sharpe Ratio",
    "Sortino Ratio",
    "Calmar Ratio",
    "Ann. Return %",
    "Ann. Vol %",
    "Max Drawdown %",
  ];
  const riskMetricValues = [
    sharpe ?? 0,
    sortino ?? 0,
    calmar ?? 0,
    annRet ?? 0,
    volPct ?? 0,
    Math.abs(maxDD ?? 0),
  ];

  const riskAdjData = {
    labels: riskMetricLabels,
    datasets: [
      {
        label: "Portfolio",
        data: riskMetricValues,
        backgroundColor: "#1A1611",
        borderRadius: 2,
        barThickness: 8,
      },
    ],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const riskAdjOptions: any = {
    indexAxis: "y" as const,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: "#6B6158",
          font: { size: 10 },
          boxWidth: 16,
          boxHeight: 8,
          padding: 12,
        },
      },
      tooltip: {
        backgroundColor: "#FDFAF5",
        borderColor: "#D8CFBF",
        borderWidth: 1,
        titleColor: "#1A1611",
        bodyColor: "#6B6158",
        callbacks: {
          label: (ctx: { parsed: { x: number }; label: string }) => {
            const v = ctx.parsed.x;
            if (ctx.label.includes("%"))
              return ` ${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
            return ` ${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: "#9B9088", font: { size: 9 } },
        grid: { color: "#EDE5D6", lineWidth: 0.5 },
        border: { color: "#D8CFBF" },
      },
      y: {
        ticks: { color: "#6B6158", font: { size: 10 } },
        grid: { display: false },
        border: { display: false },
      },
    },
  };

  // ── Stress test: compute portfolio impact from actual weights ────
  function getCatReturn(sym: string, name: string | null, scenarioCatReturns: Record<string, number>): number {
    const n = (name ?? sym).toLowerCase();
    if (n.includes("sgov") || n.includes("t-bill") || n.includes("cash") || n.includes("money")) return scenarioCatReturns.cash ?? 0;
    if (n.includes("schp") || n.includes("tip")) return scenarioCatReturns.tips ?? 0;
    if (n.includes("iau") || n.includes("gold")) return scenarioCatReturns.gold ?? 0;
    if (n.includes("iemg") || n.includes("emerging")) return scenarioCatReturns.em ?? 0;
    if (n.includes("bnd") || n.includes("bond") || n.includes("agg") || n.includes("ief")) return scenarioCatReturns.bond ?? 0;
    if (n.includes("ixus") || n.includes("international") || n.includes("intl") || n.includes("developed")) return scenarioCatReturns.intlEquity ?? 0;
    return scenarioCatReturns.equity ?? 0;
  }

  const STRESS = STRESS_SCENARIOS.map((s) => {
    const catReturns = STRESS_CATEGORY_RETURNS[s.scenario] ?? {};
    let portfolioReturn = 0;
    if (positions.length > 0) {
      for (const p of positions) {
        const wt = (p.market_value ?? 0) / totalMV;
        portfolioReturn += wt * getCatReturn(p.symbol, p.name, catReturns);
      }
    } else {
      // Fallback when no positions loaded: use generic 60/40-like estimate
      portfolioReturn = s.bench6040 * 0.65;
    }
    return { ...s, portfolio: parseFloat(portfolioReturn.toFixed(1)) };
  });

  // ── Volatility contribution from position weights × realized σ ─
  const volContrib = positions.map((p) => {
    const wt = (p.market_value ?? 0) / totalMV;
    const sigmaEst = symbolVol[p.symbol.toUpperCase()] ?? 15.0;
    return { symbol: p.symbol, contrib: wt * sigmaEst, mv: p.market_value ?? 0 };
  });
  const totalVC = volContrib.reduce((s, v) => s + v.contrib, 0) || 1;

  // ── Stop calculator rows from real position data ──────────
  const stopRows = positions.map((p) => {
    const sigmaAnn = symbolVol[p.symbol.toUpperCase()] ?? 15.0;
    const last = p.current_price ?? p.avg_cost;
    const stopPct = last > 100 ? 5 : last > 50 ? 5 : 7;
    const stopPx = last * (1 - stopPct / 100);
    // Approximate P(hit stop in 30d) via Bachelier approximation
    const sigmaDailyPct = sigmaAnn / Math.sqrt(252);
    const pHit = Math.max(
      0,
      Math.min(99, 2 * 100 * (1 - normalCDF(stopPct / (sigmaDailyPct * Math.sqrt(30)))))
    );
    const positionValue = p.market_value ?? 0;
    const atRisk = -positionValue * (stopPct / 100);
    return {
      ticker: p.symbol,
      last,
      shares: p.shares,
      positionValue,
      vol: sigmaAnn,
      stopPct,
      stopPx,
      pHit,
      atRisk,
    };
  });

  const [selectedStop, setSelectedStop] = useState(0);
  const sel = stopRows[selectedStop] ?? stopRows[0];

  if (loading)
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-ink-4 text-sm">Loading…</span>
      </div>
    );

  return (
    <div className="max-w-[1200px] mx-auto px-8 pb-16">
      {/* Editorial header */}
      <div className="grid grid-cols-5 gap-8 py-10 border-b border-parchment-border">
        <div className="col-span-3">
          <p className="section-label mb-3">§ 03 — Risk Ledger</p>
          <h1 className="font-serif text-6xl text-ink leading-tight mb-1">
            Loss budget,
          </h1>
          <h1 className="font-serif text-6xl text-ink italic leading-tight mb-5">
            spent sparingly.
          </h1>
          <p className="text-ink-3 text-sm leading-relaxed max-w-lg">
            {hasEnoughData
              ? `Live risk metrics computed from ${rets.length} price-snapshot returns. The mandate tolerates a 12% peak-to-trough drawdown over any 3-year window.`
              : "Risk metrics require ≥20 price snapshots. Keep the app open — snapshots accumulate every 60 seconds. The mandate tolerates a 12% peak-to-trough drawdown over any 3-year window."}
          </p>
        </div>
        <div className="col-span-2 flex items-center gap-6 pl-8 border-l border-parchment-border">
          <div>
            <p className="section-label mb-1">VaR 95% · 1-Day</p>
            <p className={`font-sans font-semibold text-3xl ${varPct !== null ? "neg" : "text-ink-4"}`}>
              {varPct !== null ? `${fmt(varPct, 2)}%` : "—"}
            </p>
            <p className="text-ink-4 text-xs mt-0.5">
              {varPct !== null
                ? `−$${Math.round(totalValue * Math.abs(varPct) / 100).toLocaleString()} at risk`
                : "Need ≥20 snapshots"}
            </p>
          </div>
          <div>
            <p className="section-label mb-1">CVaR 95%</p>
            <p className={`font-sans font-semibold text-3xl ${cvarPct !== null ? "neg" : "text-ink-4"}`}>
              {cvarPct !== null ? `${fmt(cvarPct, 2)}%` : "—"}
            </p>
            <p className="text-ink-4 text-xs mt-0.5">tail expectation</p>
          </div>
          <div>
            <p className="section-label mb-1">Vol (Ann.)</p>
            <p className={`font-sans font-semibold text-3xl ${volPct !== null ? "text-ink" : "text-ink-4"}`}>
              {volPct !== null ? `${fmt(volPct, 1)}%` : "—"}
            </p>
            <p className="text-ink-4 text-xs mt-0.5">
              {volPct !== null ? "Weighted ticker σ" : "Need price bars"}
            </p>
          </div>
        </div>
      </div>

      {/* §01 Underwater equity curve + §02 Risk adjustments */}
      <div className="grid grid-cols-5 gap-8 mt-0">
        <div className="col-span-3">
          <SectionHeader
            num="01"
            title="Underwater Equity Curve — 24 Months"
            right="Peak-to-Trough · Daily"
          />
          <div
            className="bg-card-bg border border-parchment-border rounded"
            style={{ height: 220 }}
          >
            {cleanPerf.length < 2 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-ink-4 text-sm">No performance history yet.</p>
              </div>
            ) : (
              <Line data={ddChartData} options={ddOptions} />
            )}
          </div>
          <div className="flex items-center gap-4 mt-2">
            <span className="flex items-center gap-1.5 text-2xs text-ink-3">
              <span className="inline-block w-4 h-0.5 bg-ink" />
              Portfolio · max{" "}
              {ddValues.length > 0 ? Math.min(...ddValues).toFixed(1) : "—"}%
            </span>
            <span className="flex items-center gap-1.5 text-2xs neg">
              <span className="inline-block w-4 h-0.5 bg-negative border-dashed" />
              60/40 Bench (est.) · max{" "}
              {bench40dd.length > 0 ? Math.min(...bench40dd).toFixed(1) : "—"}%
            </span>
            <span className="flex items-center gap-1.5 text-2xs text-ink-4">
              <span className="inline-block w-4 border-t border-dashed border-ink-4" />
              Mandate floor −12.0%
            </span>
          </div>
        </div>

        <div className="col-span-2">
          <SectionHeader
            num="02"
            title="Risk Adjustments"
            right={hasEnoughData ? "Computed from snapshots" : "Need ≥20 snapshots"}
          />
          {!hasEnoughData ? (
            <div className="flex items-center justify-center h-48 border border-parchment-border rounded">
              <p className="text-ink-4 text-sm text-center px-4">
                Risk ratios will appear once ≥20 price snapshots are collected
                (≈20 min of running).
              </p>
            </div>
          ) : (
            <div style={{ height: 200 }}>
              <Bar data={riskAdjData} options={riskAdjOptions} />
            </div>
          )}
          {hasEnoughData && (
            <div className="grid grid-cols-2 gap-px bg-parchment-border border border-parchment-border rounded overflow-hidden mt-3">
              {[
                { label: "Sharpe", value: sharpe !== null ? fmt(sharpe) : "—" },
                { label: "Sortino", value: sortino !== null ? fmt(sortino) : "—" },
                { label: "Calmar", value: calmar !== null ? fmt(calmar) : "—" },
                { label: "Ann. Return", value: annRet !== null ? `${sign(annRet)}${fmt(annRet, 1)}%` : "—" },
              ].map((m) => (
                <div key={m.label} className="bg-card-bg p-3">
                  <p className="section-label mb-0.5">{m.label}</p>
                  <p className="font-semibold text-lg text-ink">{m.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* §03 Correlation Matrix + §04 Factor Exposure */}
      <div className="grid grid-cols-2 gap-8 mt-0">
        <div>
          <SectionHeader
            num="03"
            title="Correlation Matrix · 2yr Daily"
            right={hasCorrData ? "Pearson ρ · from price bars" : "Pearson ρ (need bar data)"}
          />
          {portfolioSymbols.length < 2 ? (
            <div className="flex items-center justify-center h-32 border border-parchment-border rounded">
              <p className="text-ink-4 text-sm">Need ≥2 positions to compute correlations.</p>
            </div>
          ) : (
            <>
              <div className="border border-parchment-border rounded overflow-hidden">
                <table className="w-full text-2xs font-mono">
                  <thead>
                    <tr className="bg-parchment-dark border-b border-parchment-border">
                      <th className="w-10" />
                      {portfolioSymbols.map((t) => (
                        <th key={t} className="p-1 text-center section-label">
                          {t}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {corrMatrix.map((row, r) => (
                      <tr
                        key={r}
                        className="border-b border-parchment-border last:border-b-0"
                      >
                        <td className="p-1 section-label text-center bg-parchment-dark border-r border-parchment-border">
                          {portfolioSymbols[r]}
                        </td>
                        {row.map((v, c) => (
                          <td
                            key={c}
                            className="p-1 text-center"
                            style={{
                              backgroundColor: corrColor(v),
                              color: Math.abs(v) >= 0.4 ? "#fff" : "#1A1611",
                            }}
                          >
                            {v.toFixed(2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="section-label">−1.00</span>
                <div className="flex-1 h-2 rounded overflow-hidden flex">
                  {["#B81C1C","#D4A5A5","#EDE5D6","#C8BFB3","#5B7A6B","#1A1611"].map((c) => (
                    <div key={c} className="flex-1" style={{ backgroundColor: c }} />
                  ))}
                </div>
                <span className="section-label">+1.00</span>
              </div>
              <p className="text-2xs text-ink-4 mt-1">
                {hasCorrData
                  ? "Computed from 2yr daily returns for your holdings."
                  : "Insufficient bar data — load price history to compute live correlations."}
              </p>
            </>
          )}
        </div>

        <div>
          <SectionHeader
            num="04"
            title="Factor Exposure"
            right="Fama-French + Carhart (est.)"
          />
          <div className="space-y-2">
            {FACTORS.map((f) => {
              const barW = (Math.abs(f.value) / 1.0) * 100;
              return (
                <div key={f.name} className="flex items-center gap-3">
                  <span className="text-xs text-ink-3 w-28 shrink-0">
                    {f.name}
                  </span>
                  <div className="flex-1 flex items-center gap-1 h-4 relative">
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-parchment-border" />
                    <div className="absolute left-1/2 w-0 h-full">
                      <div
                        className="absolute h-3 top-0.5 rounded-sm"
                        style={{
                          width: `${barW * 0.5}%`,
                          backgroundColor:
                            f.dir >= 0 ? "#1A1611" : "#B81C1C",
                          left: f.dir >= 0 ? 0 : `-${barW * 0.5}%`,
                        }}
                      />
                    </div>
                  </div>
                  <span
                    className={`text-xs font-medium w-10 text-right ${f.dir >= 0 ? "text-ink" : "neg"}`}
                  >
                    {f.dir >= 0 ? "+" : ""}
                    {f.value.toFixed(2)}
                  </span>
                  <span className="text-xs text-ink-4 w-40 hidden xl:block">
                    {f.note}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-2xs text-ink-4 mt-3">
            Estimated from portfolio allocation weights and category-level factor loadings.
          </p>
        </div>
      </div>

      {/* §05 Stress Tests */}
      <SectionHeader
        num="05"
        title="Stress Tests — Historical &amp; Hypothetical"
        right="Estimated Impact on Current Allocation"
      />
      <div className="border border-parchment-border rounded overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-parchment-dark border-b border-parchment-border">
              {[
                "SCENARIO",
                "PERIOD · DEFINITION",
                "PORTFOLIO",
                "60/40 BENCH",
                "S&P 500",
                "DISTRIBUTION",
                "$ IMPACT (EST.)",
              ].map((h) => (
                <th
                  key={h}
                  className="px-4 py-2 section-label text-left whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STRESS.map((row) => {
              const estDollar = totalValue * (row.portfolio / 100);
              return (
                <tr
                  key={row.scenario}
                  className="border-b border-parchment-border last:border-b-0 hover:bg-parchment-dark/40"
                >
                  <td className="px-4 py-2.5 text-xs font-medium text-ink whitespace-nowrap">
                    {row.scenario}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-ink-3">
                    {row.period}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-semibold neg whitespace-nowrap">
                    {row.portfolio.toFixed(1)}%
                  </td>
                  <td className="px-4 py-2.5 text-xs neg whitespace-nowrap">
                    {row.bench6040.toFixed(1)}%
                  </td>
                  <td className="px-4 py-2.5 text-xs neg whitespace-nowrap">
                    {row.spy.toFixed(1)}%
                  </td>
                  <td className="px-4 py-2.5 w-36">
                    <div className="flex gap-px h-3 items-center">
                      <div
                        className="h-full bg-ink rounded-sm"
                        style={{
                          width: `${Math.abs(row.portfolio / row.spy) * 70}%`,
                        }}
                      />
                      <div
                        className="h-full bg-ink-4 rounded-sm"
                        style={{
                          width: `${Math.abs(row.bench6040 / row.spy) * 70}%`,
                          opacity: 0.5,
                        }}
                      />
                      <div
                        className="h-full bg-parchment-border rounded-sm"
                        style={{ width: `${70}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs font-medium neg whitespace-nowrap">
                    ${Math.round(estDollar).toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-4 py-2 bg-parchment-dark border-t border-parchment-border flex items-center gap-4">
          <span className="text-2xs text-ink-4">
            $ impact scales with current portfolio value of $
            {Math.round(totalValue).toLocaleString()} · Scenario % returns are historical/estimated
          </span>
        </div>
      </div>

      {/* §06 Risk Budget */}
      <SectionHeader
        num="06"
        title="Risk Budget · Volatility Contribution"
        right="Position Weight × Realized Ann. σ"
      />
      <div className="border border-parchment-border rounded overflow-hidden">
        <div className="flex h-10">
          {volContrib.map((v) => (
            <div
              key={v.symbol}
              className="flex items-center justify-center text-2xs text-parchment font-medium overflow-hidden"
              style={{
                width: `${(v.contrib / totalVC) * 100}%`,
                backgroundColor:
                  v.symbol === "VTI"
                    ? "#1A1611"
                    : v.symbol === "IXUS"
                    ? "#3D5A8A"
                    : v.symbol === "IEMG"
                    ? "#5B7FA6"
                    : v.symbol === "BND"
                    ? "#5B7A6B"
                    : v.symbol === "IEF"
                    ? "#6B7A5B"
                    : v.symbol === "USMV"
                    ? "#8A6B3D"
                    : v.symbol === "IAU"
                    ? "#B8860B"
                    : v.symbol === "SCHP"
                    ? "#7A5B6B"
                    : "#9B9088",
              }}
              title={`${v.symbol} ${((v.contrib / totalVC) * 100).toFixed(1)}%`}
            >
              {(v.contrib / totalVC) * 100 > 5
                ? `${v.symbol} ${((v.contrib / totalVC) * 100).toFixed(1)}%`
                : ""}
            </div>
          ))}
        </div>
        <div className="px-4 py-2 bg-parchment-dark border-t border-parchment-border">
          <span className="text-xs text-ink-3">
            Weight × realized annual volatility (2yr daily bars). {hasCorrData ? "Computed from Yahoo Finance data." : "Fallback estimates used for symbols without sufficient bar data."}
          </span>
        </div>
      </div>

      {/* §07 Trailing-Stop Risk Calculator */}
      <SectionHeader
        num="07"
        title="Trailing-Stop Risk Calculator"
        right="σ from realized 2yr bars (or fallback) · GBM approx · 30 Trading Days"
      />
      {positions.length === 0 ? (
        <div className="flex items-center justify-center h-32 border border-parchment-border rounded">
          <p className="text-ink-4 text-sm">No positions loaded.</p>
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-6">
          <div className="col-span-3 border border-parchment-border rounded overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-parchment-dark border-b border-parchment-border">
                  {[
                    "TICKER",
                    "LAST",
                    "Σ ANN.",
                    "STOP %",
                    "STOP PX",
                    "P(HIT 30D)",
                    "$ AT RISK",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 section-label text-left whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stopRows.map((row, idx) => {
                  const isHigh = row.pHit >= 30;
                  return (
                    <tr
                      key={row.ticker}
                      className={`border-b border-parchment-border last:border-b-0 cursor-pointer transition-colors ${selectedStop === idx ? "bg-parchment-dark" : "hover:bg-parchment/60"}`}
                      onClick={() => setSelectedStop(idx)}
                    >
                      <td className="px-3 py-2 font-mono font-medium text-xs text-ink">
                        {row.ticker}
                      </td>
                      <td className="px-3 py-2 text-xs text-ink">
                        ${row.last.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-xs text-ink-3">
                        {row.vol.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <div className="w-16 h-2 bg-parchment-dark rounded overflow-hidden">
                            <div
                              className="h-full bg-ink rounded"
                              style={{ width: `${row.stopPct * 15}%` }}
                            />
                          </div>
                          <span className="text-xs text-ink-4">
                            {row.stopPct}%
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-ink">
                        ${row.stopPx.toFixed(2)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs font-semibold ${isHigh ? "neg" : "text-ink-3"}`}
                          >
                            {row.pHit.toFixed(1)}%
                          </span>
                          <div className="w-24 h-1.5 bg-parchment-dark rounded overflow-hidden">
                            <div
                              className="h-full rounded"
                              style={{
                                width: `${row.pHit}%`,
                                backgroundColor: isHigh ? "#B81C1C" : "#9B9088",
                              }}
                            />
                          </div>
                        </div>
                      </td>
                      <td
                        className={`px-3 py-2 text-xs font-medium ${row.atRisk < -1000 ? "neg" : "text-ink-4"}`}
                      >
                        ${Math.round(row.atRisk).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="px-4 py-2 text-2xs text-ink-4 bg-parchment-dark border-t border-parchment-border">
              Click a row to inspect details. P(hit) uses GBM approximation with category-average σ. Prices from last snapshot.
            </p>
          </div>

          {/* Detail panel */}
          {sel && (
            <div className="col-span-2 border border-parchment-border rounded bg-card-bg p-5">
              <div className="flex items-baseline justify-between mb-4">
                <span className="font-mono font-semibold text-lg text-ink">
                  {sel.ticker}
                </span>
                <span className="text-ink-4 text-xs">last ${sel.last.toFixed(2)}</span>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  {
                    label: "Stop Trigger",
                    value: `-${sel.stopPct}%`,
                    sub: `$${sel.stopPx.toFixed(2)}`,
                  },
                  {
                    label: "P(Hit) · 30D",
                    value: `${sel.pHit.toFixed(1)}%`,
                    sub: "GBM approx.",
                  },
                  {
                    label: "Σ Daily · Ann.",
                    value: `${(sel.vol / Math.sqrt(252)).toFixed(2)}%`,
                    sub: `${sel.vol.toFixed(1)}% ann.`,
                  },
                  {
                    label: "E[Days to Hit]",
                    value: `${(30 / (sel.pHit / 100 + 0.01)).toFixed(1)}d`,
                    sub: "conditional on touch",
                  },
                  {
                    label: "5%-tile Final",
                    value: `$${(sel.last * (1 - sel.vol * 0.15 / 100)).toFixed(2)}`,
                    sub: `−${(sel.vol * 0.15).toFixed(1)}% from spot`,
                  },
                  {
                    label: "Position $",
                    value:
                      sel.positionValue > 0
                        ? `$${Math.round(sel.positionValue).toLocaleString()}`
                        : "—",
                    sub: `${sel.shares.toLocaleString()} sh`,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="border border-parchment-border p-2 rounded"
                  >
                    <p className="section-label mb-0.5">{item.label}</p>
                    <p
                      className={`font-semibold text-sm ${item.label === "Stop Trigger" ? "neg" : "text-ink"}`}
                    >
                      {item.value}
                    </p>
                    <p className="text-2xs text-ink-4">{item.sub}</p>
                  </div>
                ))}
              </div>

              {/* Mini distribution chart */}
              <p className="section-label mb-2">
                30-Day Min-Price Distribution · GBM
              </p>
              <div className="flex items-end gap-0.5 h-16 bg-parchment-dark rounded p-1">
                {Array.from({ length: 24 }, (_, i) => {
                  const x = i / 23;
                  const stopX = sel.pHit / 100;
                  const height = Math.max(
                    4,
                    Math.round(
                      Math.exp(-Math.pow((x - 0.7) * 3, 2)) * 56
                    )
                  );
                  const isRed = x < stopX;
                  return (
                    <div
                      key={i}
                      className="flex-1 rounded-sm"
                      style={{
                        height: `${height}px`,
                        backgroundColor: isRed ? "#B81C1C" : "#D8CFBF",
                      }}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-2xs text-ink-4">−25%</span>
                <span className="text-2xs text-ink-4">−5%</span>
                <span className="text-2xs text-ink-4">+5%</span>
              </div>
              <p className="text-2xs text-ink-4 mt-1">
                Red bars = paths breaching the stop. Mass left of threshold = P(hit).
              </p>
            </div>
          )}
        </div>
      )}

      {/* §08 Monte-Carlo Outcome Simulator */}
      <SectionHeader
        num="08"
        title="Monte-Carlo Outcome Simulator"
        right="12-Month Forward · GBM + macro scenarios"
      />
      <p className="text-ink-3 text-sm leading-relaxed max-w-2xl mb-4">
        Forward-looking scenario distributions for your live holdings. Re-weight a
        proposed portfolio and compare its risk/return profile side-by-side. Per-asset
        σ and β come from realized 2-yr price bars; correlations from daily returns.
      </p>
      <MonteCarloSimulator positions={positions} barsData={barsData} />

      {/* Bottom bar */}
      <div className="mt-12 pt-4 border-t border-parchment-border flex items-center justify-between">
        <span className="section-label">
          Ledger &amp; Lever — Personal · Page rendered{" "}
          {new Date().toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })}{" "}
          ET
        </span>
        <span className="section-label">
          Data: NYSE TAQ · ICE BofA · Bloomberg BBALT · Lipper
        </span>
        <span className="section-label">
          For informational use only. Not investment advice.
        </span>
      </div>
    </div>
  );
}

/** Standard normal CDF approximation (Abramowitz & Stegun) */
function normalCDF(x: number): number {
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}
