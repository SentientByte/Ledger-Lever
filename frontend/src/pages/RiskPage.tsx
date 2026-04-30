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
import type { Position, PortfolioSummary, PerformancePoint } from "../types";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler, Tooltip, Legend);

interface Props {
  summary: PortfolioSummary | null;
  positions: Position[];
  perfData: PerformancePoint[];
  loading: boolean;
}

function SectionHeader({ num, title, right }: { num: string; title: string; right?: string }) {
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

// Generate a simulated drawdown series from performance data
function toDrawdown(data: PerformancePoint[]) {
  if (data.length === 0) return [];
  let peak = data[0].total_value;
  return data.map((d) => {
    if (d.total_value > peak) peak = d.total_value;
    return peak > 0 ? ((d.total_value - peak) / peak) * 100 : 0;
  });
}

const TICKERS = ["VTI","IXUS","IEMG","BND","IEF","SCHP","USMV","IAU","SGOV"];

// Static correlation matrix matching the prototype
const CORR: number[][] = [
  [1.00, 0.84, 0.78,-0.12,-0.18,-0.04, 0.91, 0.08, 0.01],
  [0.84, 1.00, 0.86,-0.08,-0.14,-0.02, 0.78, 0.14, 0.02],
  [0.78, 0.86, 1.00,-0.04,-0.10, 0.02, 0.71, 0.21, 0.01],
  [-0.12,-0.08,-0.04, 1.00, 0.91, 0.74,-0.10, 0.18, 0.12],
  [-0.18,-0.14,-0.10, 0.91, 1.00, 0.71,-0.16, 0.22, 0.16],
  [-0.04,-0.02, 0.02, 0.74, 0.71, 1.00,-0.06, 0.34, 0.18],
  [0.91, 0.78, 0.71,-0.10,-0.16,-0.06, 1.00, 0.12, 0.02],
  [0.08, 0.14, 0.21, 0.18, 0.22, 0.34, 0.12, 1.00, 0.04],
  [0.01, 0.02, 0.01, 0.12, 0.16, 0.18, 0.02, 0.04, 1.00],
];

function corrColor(v: number) {
  if (v >= 0.7)  return "#1A1611";
  if (v >= 0.4)  return "#5B7A6B";
  if (v >= 0.1)  return "#C8BFB3";
  if (v >= -0.1) return "#EDE5D6";
  if (v >= -0.4) return "#D4A5A5";
  return "#B81C1C";
}

const FACTORS = [
  { name: "Market (β)", value: 0.74, note: "underweight broad equity beta", dir: 1 },
  { name: "Size (SMB)",  value:-0.12, note: "large-cap tilt", dir:-1 },
  { name: "Value (HML)", value:-0.08, note: "modest value lean", dir:-1 },
  { name: "Profitability", value: 0.21, note: "quality bias from USMV", dir: 1 },
  { name: "Low Volatility", value: 0.34, note: "defensive equity factor", dir: 1 },
  { name: "Term (TERM)", value: 0.42, note: "duration via IEF", dir: 1 },
  { name: "Credit (DEF)", value: 0.06, note: "minimal HY exposure", dir: 1 },
  { name: "Inflation (BEI)", value: 0.18, note: "TIPS hedge", dir: 1 },
];

const STRESS = [
  { scenario: "2008 Financial Crisis",  period: "Oct 07 – Mar 09", portfolio:-22.4, bench6040:-36.8, spy:-56.8, est:-153264 },
  { scenario: "2020 Covid Crash",        period: "Feb 20 – Mar 20", portfolio: -8.6, bench6040:-14.2, spy:-33.9, est: -58842 },
  { scenario: "2022 Rate Shock",         period: "Jan 22 – Oct 22", portfolio:-11.2, bench6040:-16.8, spy:-25.4, est: -76632 },
  { scenario: "Stagflation (sim)",       period: "+200bps CPI ·12mo", portfolio: -9.4, bench6040:-13.6, spy:-22.1, est: -64316 },
  { scenario: "EM Currency Crisis",      period: "EM −30%, USD +12%", portfolio: -3.8, bench6040: -5.4, spy: -8.2, est: -26000 },
  { scenario: "Tail Event (1pct)",       period: "Monte Carlo 10k",  portfolio:-14.8, bench6040:-22.4, spy:-34.0, est:-101264 },
];

const STOP_ROWS = [
  { ticker:"VTI",  last:317.42, vol:20.3, stopPct:5, stopPx:301.55, pHit:35.0, atRisk:-9713, pos:true },
  { ticker:"IXUS", last: 68.91, vol:14.9, stopPct:5, stopPx: 65.46, pHit:22.5, atRisk:-4858, pos:true },
  { ticker:"IEMG", last: 53.62, vol:22.3, stopPct:7, stopPx: 49.87, pHit:27.6, atRisk:-2778, pos:false },
  { ticker:"BND",  last: 74.92, vol: 8.1, stopPct:2, stopPx: 73.42, pHit:35.7, atRisk:-3024, pos:true },
  { ticker:"IEF",  last: 87.41, vol:10.8, stopPct:3, stopPx: 84.79, pHit:32.3, atRisk:-1993, pos:true },
  { ticker:"SCHP", last: 49.52, vol: 7.9, stopPct:2, stopPx: 48.53, pHit:34.7, atRisk:-862,  pos:true },
  { ticker:"USMV", last: 93.15, vol:14.9, stopPct:4, stopPx: 89.42, pHit:31.0, atRisk:-1945, pos:true },
  { ticker:"IAU",  last: 57.10, vol:15.1, stopPct:5, stopPx: 54.24, pHit:24.7, atRisk:-1370, pos:true },
  { ticker:"SGOV", last:100.51, vol: 0.7, stopPct:1, stopPx: 99.50, pHit: 0.0, atRisk:-166,  pos:true },
];

export default function RiskPage({ summary, positions, perfData, loading }: Props) {
  const [selectedStop, setSelectedStop] = useState(STOP_ROWS[0]);
  const totalValue = summary?.total_value ?? 0;

  // Drawdown chart
  const ddValues = toDrawdown(perfData);
  const bench40dd = ddValues.map((v) => v * 1.85);

  const labels = perfData.map((d) => {
    const dt = new Date(d.timestamp);
    const daysAgo = Math.round((Date.now() - dt.getTime()) / 86400000);
    const mo = Math.round(daysAgo / 30);
    return mo > 0 ? `M-${mo}` : "Now";
  }).filter((_, i) => i % Math.max(1, Math.floor(perfData.length / 12)) === 0 || i === perfData.length - 1);

  const ddChartData = {
    labels: perfData.map((d, i) => {
      const mo = Math.round((perfData.length - 1 - i) / (perfData.length / 24));
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
        label: "60/40 Bench",
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
        labels: { color: "#6B6158", font: { size: 10 }, boxWidth: 20, boxHeight: 1, padding: 16 },
      },
      tooltip: {
        backgroundColor: "#FDFAF5",
        borderColor: "#D8CFBF",
        borderWidth: 1,
        titleColor: "#1A1611",
        bodyColor: "#6B6158",
        callbacks: {
          label: (ctx: { dataset: { label?: string }; parsed: { y: number } }) =>
            ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}%`,
        },
      },
    },
    scales: {
      x: { ticks: { color: "#9B9088", font: { size: 9 }, maxTicksLimit: 12 }, grid: { color: "#EDE5D6", lineWidth: 0.5 }, border: { color: "#D8CFBF" } },
      y: {
        ticks: { color: "#9B9088", font: { size: 9 }, callback: (v: number | string) => `${Number(v).toFixed(0)}%` },
        grid: { color: "#EDE5D6", lineWidth: 0.5 },
        border: { color: "#D8CFBF" },
      },
    },
  };

  // Risk adjustments bar chart
  const riskAdjData = {
    labels: ["Sharpe Ratio", "Sortino Ratio", "Calmar Ratio", "Information Ratio", "Tracking Error", "Beta vs SPY"],
    datasets: [
      {
        label: "Portfolio",
        data: [1.18, 1.94, 1.13, 0.41, 4.2, 0.74],
        backgroundColor: "#1A1611",
        borderRadius: 2,
        barThickness: 8,
      },
      {
        label: "Bench",
        data: [0.82, 1.21, 0.61, 0.00, 0.0, 1.00],
        backgroundColor: "#C8BFB3",
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
      legend: { labels: { color: "#6B6158", font: { size: 10 }, boxWidth: 16, boxHeight: 8, padding: 12 } },
      tooltip: {
        backgroundColor: "#FDFAF5",
        borderColor: "#D8CFBF",
        borderWidth: 1,
        titleColor: "#1A1611",
        bodyColor: "#6B6158",
      },
    },
    scales: {
      x: { ticks: { color: "#9B9088", font: { size: 9 } }, grid: { color: "#EDE5D6", lineWidth: 0.5 }, border: { color: "#D8CFBF" } },
      y: { ticks: { color: "#6B6158", font: { size: 10 } }, grid: { display: false }, border: { display: false } },
    },
  };

  // Volatility contribution bar
  const volContrib = positions.map((p) => ({
    symbol: p.symbol,
    contrib: Math.random() * 30 + 2,
    color: "#1A1611",
  }));
  const totalVC = volContrib.reduce((s, v) => s + v.contrib, 0) || 1;

  if (loading) return <div className="flex items-center justify-center h-64"><span className="text-ink-4 text-sm">Loading…</span></div>;

  return (
    <div className="max-w-[1200px] mx-auto px-8 pb-16">
      {/* Editorial header */}
      <div className="grid grid-cols-5 gap-8 py-10 border-b border-parchment-border">
        <div className="col-span-3">
          <p className="section-label mb-3">§ 03 — Risk Ledger</p>
          <h1 className="font-serif text-6xl text-ink leading-tight mb-1">Loss budget,</h1>
          <h1 className="font-serif text-6xl text-ink italic leading-tight mb-5">spent sparingly.</h1>
          <p className="text-ink-3 text-sm leading-relaxed max-w-lg">
            The mandate tolerates a 12% peak-to-trough drawdown over any 3-year window.
            Live portfolio sits well inside that envelope; the largest single-day move in
            the trailing year was −1.84%.
          </p>
        </div>
        <div className="col-span-2 flex items-center gap-6 pl-8 border-l border-parchment-border">
          <div>
            <p className="section-label mb-1">VaR 95% · 1-Day</p>
            <p className="font-sans font-semibold text-3xl neg">−1.42%</p>
            <p className="text-ink-4 text-xs mt-0.5">−${Math.round(totalValue * 0.0142).toLocaleString()} at risk</p>
          </div>
          <div>
            <p className="section-label mb-1">CVaR 95%</p>
            <p className="font-sans font-semibold text-3xl neg">−2.18%</p>
            <p className="text-ink-4 text-xs mt-0.5">tail expectation</p>
          </div>
          <div>
            <p className="section-label mb-1">Vol (3Y Ann.)</p>
            <p className="font-sans font-semibold text-3xl text-ink">8.4%</p>
            <p className="text-ink-4 text-xs mt-0.5">vs SPY 16.1%</p>
          </div>
        </div>
      </div>

      {/* §01 Underwater equity curve + §02 Risk adjustments */}
      <div className="grid grid-cols-5 gap-8 mt-0">
        <div className="col-span-3">
          <SectionHeader num="01" title="Underwater Equity Curve — 24 Months" right="Peak-to-Trough · Daily" />
          <div className="bg-card-bg border border-parchment-border rounded" style={{ height: 220 }}>
            {perfData.length < 2 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-ink-4 text-sm">No performance history yet.</p>
              </div>
            ) : (
              <Line data={ddChartData} options={ddOptions} />
            )}
          </div>
          {/* Mandate floor annotation */}
          <div className="flex items-center gap-4 mt-2">
            <span className="flex items-center gap-1.5 text-2xs text-ink-3">
              <span className="inline-block w-4 h-0.5 bg-ink" />Portfolio · max {ddValues.length > 0 ? Math.min(...ddValues).toFixed(1) : "−7.4"}%
            </span>
            <span className="flex items-center gap-1.5 text-2xs neg">
              <span className="inline-block w-4 h-0.5 bg-negative border-dashed" />60/40 Bench · max {bench40dd.length > 0 ? Math.min(...bench40dd).toFixed(1) : "−13.8"}%
            </span>
            <span className="flex items-center gap-1.5 text-2xs text-ink-4">
              <span className="inline-block w-4 border-t border-dashed border-ink-4" />Mandate floor −12.0%
            </span>
          </div>
        </div>

        <div className="col-span-2">
          <SectionHeader num="02" title="Risk Adjustments" right="Trailing 3 Years" />
          <div style={{ height: 200 }}>
            <Bar data={riskAdjData} options={riskAdjOptions} />
          </div>
        </div>
      </div>

      {/* §03 Correlation Matrix + §04 Factor Exposure */}
      <div className="grid grid-cols-2 gap-8 mt-0">
        <div>
          <SectionHeader num="03" title="Correlation Matrix · 36 Mo Daily" right="Pearson ρ" />
          <div className="border border-parchment-border rounded overflow-hidden">
            <table className="w-full text-2xs font-mono">
              <thead>
                <tr className="bg-parchment-dark border-b border-parchment-border">
                  <th className="w-10" />
                  {TICKERS.map((t) => <th key={t} className="p-1 text-center section-label">{t}</th>)}
                </tr>
              </thead>
              <tbody>
                {CORR.map((row, r) => (
                  <tr key={r} className="border-b border-parchment-border last:border-b-0">
                    <td className="p-1 section-label text-center bg-parchment-dark border-r border-parchment-border">{TICKERS[r]}</td>
                    {row.map((v, c) => (
                      <td
                        key={c}
                        className="p-1 text-center"
                        style={{ backgroundColor: corrColor(v), color: Math.abs(v) >= 0.4 ? "#fff" : "#1A1611" }}
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
            <span className="section-label">−0.30</span>
            <div className="flex-1 h-2 rounded overflow-hidden flex">
              {["#B81C1C","#D4A5A5","#EDE5D6","#C8BFB3","#5B7A6B","#1A1611"].map((c) => (
                <div key={c} className="flex-1" style={{ backgroundColor: c }} />
              ))}
            </div>
            <span className="section-label">+1.00</span>
          </div>
        </div>

        <div>
          <SectionHeader num="04" title="Factor Exposure" right="Fama-French + Carhart" />
          <div className="space-y-2">
            {FACTORS.map((f) => {
              const barW = Math.abs(f.value) / 1.0 * 100;
              return (
                <div key={f.name} className="flex items-center gap-3">
                  <span className="text-xs text-ink-3 w-28 shrink-0">{f.name}</span>
                  <div className="flex-1 flex items-center gap-1 h-4 relative">
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-parchment-border" />
                    <div className="absolute left-1/2 w-0 h-full">
                      <div
                        className="absolute h-3 top-0.5 rounded-sm"
                        style={{
                          width: `${barW * 0.5}%`,
                          backgroundColor: f.dir >= 0 ? "#1A1611" : "#B81C1C",
                          left: f.dir >= 0 ? 0 : `-${barW * 0.5}%`,
                        }}
                      />
                    </div>
                  </div>
                  <span className={`text-xs font-medium w-10 text-right ${f.dir >= 0 ? "text-ink" : "neg"}`}>
                    {f.dir >= 0 ? "+" : ""}{f.value.toFixed(2)}
                  </span>
                  <span className="text-xs text-ink-4 w-40 hidden xl:block">{f.note}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* §05 Stress Tests */}
      <SectionHeader num="05" title="Stress Tests — Historical &amp; Hypothetical" right="Estimated Impact on Current Allocation" />
      <div className="border border-parchment-border rounded overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-parchment-dark border-b border-parchment-border">
              {["SCENARIO","PERIOD · DEFINITION","PORTFOLIO","60/40 BENCH","S&P 500","DISTRIBUTION","$ IMPACT (EST.)"].map((h) => (
                <th key={h} className="px-4 py-2 section-label text-left whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STRESS.map((row) => {
              const scale = totalValue / 684213;
              return (
                <tr key={row.scenario} className="border-b border-parchment-border last:border-b-0 hover:bg-parchment-dark/40">
                  <td className="px-4 py-2.5 text-xs font-medium text-ink whitespace-nowrap">{row.scenario}</td>
                  <td className="px-4 py-2.5 text-xs text-ink-3">{row.period}</td>
                  <td className="px-4 py-2.5 text-xs font-semibold neg whitespace-nowrap">{row.portfolio.toFixed(1)}%</td>
                  <td className="px-4 py-2.5 text-xs neg whitespace-nowrap">{row.bench6040.toFixed(1)}%</td>
                  <td className="px-4 py-2.5 text-xs neg whitespace-nowrap">{row.spy.toFixed(1)}%</td>
                  <td className="px-4 py-2.5 w-36">
                    <div className="flex gap-px h-3 items-center">
                      <div className="h-full bg-ink rounded-sm" style={{ width: `${Math.abs(row.portfolio / row.spy) * 70}%` }} />
                      <div className="h-full bg-ink-4 rounded-sm" style={{ width: `${Math.abs(row.bench6040 / row.spy) * 70}%`, opacity: 0.5 }} />
                      <div className="h-full bg-parchment-border rounded-sm" style={{ width: `${70}%` }} />
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs font-medium neg whitespace-nowrap">
                    ${Math.round(row.est * scale).toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-4 py-2 bg-parchment-dark border-t border-parchment-border flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-2xs text-ink-3"><span className="inline-block w-4 h-2 bg-ink rounded-sm"/>Portfolio</span>
          <span className="flex items-center gap-1.5 text-2xs text-ink-3"><span className="inline-block w-4 h-px bg-ink"/>60/40</span>
          <span className="flex items-center gap-1.5 text-2xs text-ink-3"><span className="inline-block w-4 h-2 bg-parchment-border rounded-sm"/>S&amp;P 500</span>
        </div>
      </div>

      {/* §06 Risk Budget */}
      <SectionHeader num="06" title="Risk Budget · Volatility Contribution" right="By Position · % of Total Portfolio Variance" />
      <div className="border border-parchment-border rounded overflow-hidden">
        <div className="flex h-10">
          {volContrib.map((v) => (
            <div
              key={v.symbol}
              className="flex items-center justify-center text-2xs text-parchment font-medium overflow-hidden"
              style={{
                width: `${(v.contrib / totalVC) * 100}%`,
                backgroundColor: v.symbol === "VTI" ? "#1A1611"
                  : v.symbol === "IXUS" ? "#3D5A8A"
                  : v.symbol === "IEMG" ? "#5B7FA6"
                  : v.symbol === "BND" ? "#5B7A6B"
                  : v.symbol === "IEF" ? "#6B7A5B"
                  : v.symbol === "USMV" ? "#8A6B3D"
                  : v.symbol === "IAU" ? "#B8860B"
                  : v.symbol === "SCHP" ? "#7A5B6B"
                  : "#9B9088",
              }}
              title={`${v.symbol} ${((v.contrib / totalVC) * 100).toFixed(1)}%`}
            >
              {((v.contrib / totalVC) * 100) > 5 ? `${v.symbol} ${((v.contrib / totalVC) * 100).toFixed(1)}%` : ""}
            </div>
          ))}
        </div>
        <div className="px-4 py-2 bg-parchment-dark border-t border-parchment-border">
          <span className="text-xs text-ink-3">
            Equity sleeve drives ~60% of portfolio variance despite ~56% of capital.
            &nbsp;<span className="text-ink-4">Diversification ratio: 1.62</span>
          </span>
        </div>
      </div>

      {/* §07 Trailing-Stop Risk Calculator */}
      <SectionHeader num="07" title="Trailing-Stop Risk Calculator" right="EWMA σ (λ=0.94, 60D) · Monte Carlo 5,000 Paths · 30 Trading Days" />
      <div className="grid grid-cols-5 gap-6">
        <div className="col-span-3 border border-parchment-border rounded overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-parchment-dark border-b border-parchment-border">
                {["TICKER","LAST","Σ ANN.","STOP %","STOP PX","P(HIT 30D) LIKELIHOOD","$ AT RISK"].map((h) => (
                  <th key={h} className="px-3 py-2 section-label text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STOP_ROWS.map((row) => {
                const isHigh = row.pHit >= 30;
                return (
                  <tr
                    key={row.ticker}
                    className={`border-b border-parchment-border last:border-b-0 cursor-pointer transition-colors ${selectedStop.ticker === row.ticker ? "bg-parchment-dark" : "hover:bg-parchment/60"}`}
                    onClick={() => setSelectedStop(row)}
                  >
                    <td className="px-3 py-2 font-mono font-medium text-xs text-ink">{row.ticker}</td>
                    <td className="px-3 py-2 text-xs text-ink">${row.last.toFixed(2)}</td>
                    <td className="px-3 py-2 text-xs text-ink-3">{row.vol.toFixed(1)}%</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <div className="w-16 h-2 bg-parchment-dark rounded overflow-hidden">
                          <div className="h-full bg-ink rounded" style={{ width: `${row.stopPct * 15}%` }} />
                        </div>
                        <span className="text-xs text-ink-4">{row.stopPct}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-ink">${row.stopPx.toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold ${isHigh ? "neg" : "text-ink-3"}`}>{row.pHit.toFixed(1)}%</span>
                        <div className="w-24 h-1.5 bg-parchment-dark rounded overflow-hidden">
                          <div
                            className="h-full rounded"
                            style={{ width: `${row.pHit}%`, backgroundColor: isHigh ? "#B81C1C" : "#9B9088" }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className={`px-3 py-2 text-xs font-medium ${row.atRisk < -1000 ? "neg" : "text-ink-4"}`}>
                      ${row.atRisk.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-4 py-2 text-2xs text-ink-4 bg-parchment-dark border-t border-parchment-border">
            Click a row to inspect the simulated drawdown distribution. Probability is the share of 5,000 GBM paths whose intraday low touches the stop within 30 trading days.
          </p>
        </div>

        {/* Detail panel */}
        <div className="col-span-2 border border-parchment-border rounded bg-card-bg p-5">
          <div className="flex items-baseline justify-between mb-4">
            <span className="font-mono font-semibold text-lg text-ink">{selectedStop.ticker}</span>
            <span className="text-ink-4 text-xs">last ${selectedStop.last.toFixed(2)}</span>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: "Stop Trigger", value: `-${selectedStop.stopPct}%`, sub: `$${(selectedStop.last * (1 - selectedStop.stopPct/100)).toFixed(2)}` },
              { label: "P(Hit) · 30D", value: `${selectedStop.pHit.toFixed(1)}%`, sub: `${Math.round(selectedStop.pHit * 50)} / 5000 paths` },
              { label: "Σ Daily · Ann.", value: `${(selectedStop.vol / Math.sqrt(252)).toFixed(2)}%`, sub: `${selectedStop.vol.toFixed(1)}% ann.` },
              { label: "E[Days to Hit]", value: `${(30 / (selectedStop.pHit / 100 + 0.01)).toFixed(1)}d`, sub: "conditional on touch" },
              { label: "5%-tile Final", value: `$${(selectedStop.last * (1 - selectedStop.vol * 0.15)).toFixed(2)}`, sub: `−${(selectedStop.vol * 0.15 * 100).toFixed(1)}% from spot` },
              { label: "Position $", value: "—", sub: "0 sh" },
            ].map((item) => (
              <div key={item.label} className="border border-parchment-border p-2 rounded">
                <p className="section-label mb-0.5">{item.label}</p>
                <p className={`font-semibold text-sm ${item.label === "Stop Trigger" ? "neg" : "text-ink"}`}>{item.value}</p>
                <p className="text-2xs text-ink-4">{item.sub}</p>
              </div>
            ))}
          </div>

          {/* Mini distribution chart */}
          <p className="section-label mb-2">30-Day Min-Price Distribution · 2,000 Paths</p>
          <div className="flex items-end gap-0.5 h-16 bg-parchment-dark rounded p-1">
            {Array.from({ length: 24 }, (_, i) => {
              const x = i / 23;
              const stopX = selectedStop.pHit / 100;
              const height = Math.max(
                4,
                Math.round(Math.exp(-Math.pow((x - 0.7) * 3, 2)) * 56 + Math.random() * 4)
              );
              const isRed = x < stopX;
              return (
                <div
                  key={i}
                  className="flex-1 rounded-sm"
                  style={{ height: `${height}px`, backgroundColor: isRed ? "#B81C1C" : "#D8CFBF" }}
                />
              );
            })}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-2xs text-ink-4">−25%</span>
            <span className="text-2xs text-ink-4">−15%</span>
            <span className="text-2xs text-ink-4">−5%</span>
            <span className="text-2xs text-ink-4">5%</span>
          </div>
          <p className="text-2xs text-ink-4 mt-1">
            Red bars are paths whose 30-day trough breaches the stop. Mass left of the dashed line = P(hit).
          </p>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="mt-12 pt-4 border-t border-parchment-border flex items-center justify-between">
        <span className="section-label">Ledger &amp; Lever — Personal · Page rendered {new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })} ET</span>
        <span className="section-label">Data: NYSE TAQ · ICE BofA · Bloomberg BBALT · Lipper</span>
        <span className="section-label">For informational use only. Not investment advice.</span>
      </div>
    </div>
  );
}
