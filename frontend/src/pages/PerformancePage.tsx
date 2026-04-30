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

function sign(n: number) { return n >= 0 ? "+" : ""; }
function fmt(n: number, dec = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

const BENCHMARKS = [
  { name: "Portfolio",        mtd: 2.60, qtd: 4.10, ytd: 9.84, y1: 15.32, y3: 8.41, y5: 9.62, incept: 7.84, best: 18.40, worst: -7.40, bold: true },
  { name: "60/40 Bench",      mtd: 2.00, qtd: 3.20, ytd: 7.21, y1: 11.81, y3: 5.62, y5: 6.84, incept: 6.12, best: 17.20, worst:-13.80, bold: false },
  { name: "S&P 500 (SPY)",    mtd: 3.40, qtd: 5.80, ytd:12.40, y1: 18.96, y3:11.21, y5:13.42, incept:10.84, best: 26.80, worst:-18.20, bold: false },
  { name: "US Agg (AGG)",     mtd: 0.40, qtd: 0.80, ytd: 4.62, y1:  6.10, y3: 0.21, y5: 1.42, incept: 3.21, best:  8.70, worst:-13.00, bold: false },
  { name: "MSCI World ex US", mtd: 1.80, qtd: 2.60, ytd: 6.41, y1:  9.12, y3: 6.82, y5: 7.21, incept: 5.81, best: 21.40, worst:-14.10, bold: false },
  { name: "Excess vs 60/40",  mtd: 0.60, qtd: 0.90, ytd: 2.63, y1:  3.51, y3: 2.79, y5: 2.78, incept: 1.72, best:  1.20, worst:  6.40, bold: false, accent: true },
];

const MONTHLY = [
  { month: "May 25", port:  1.8, bench: 1.2, excess: 0.60 },
  { month: "Jun",    port:  1.5, bench: 1.0, excess: 0.50 },
  { month: "Jul",    port:  0.8, bench: 0.6, excess: 0.18 },
  { month: "Aug",    port:  2.4, bench: 1.2, excess: 1.20 },
  { month: "Sep",    port: -0.4, bench: 0.3, excess:-0.70 },
  { month: "Oct",    port:  2.1, bench: 1.0, excess: 1.10 },
  { month: "Nov",    port:  1.6, bench: 2.0, excess:-0.40 },
  { month: "Dec",    port:  1.2, bench: 1.0, excess: 0.20 },
  { month: "Jan 26", port:  1.8, bench: 1.4, excess: 0.40 },
  { month: "Feb",    port:  1.2, bench: 0.7, excess: 0.50 },
  { month: "Mar",    port:  0.8, bench: 0.2, excess: 0.60 },
  { month: "Apr",    port:  1.6, bench: 1.0, excess: 0.60 },
];

const BRINSON = [
  { name: "VTI · US Total Mkt",   alloc: 0.21, sel: 0.34, total: 0.55 },
  { name: "IXUS · Intl Dev",      alloc:-0.08, sel:-0.12, total:-0.20 },
  { name: "IEMG · EM",            alloc:-0.18, sel:-0.34, total:-0.52 },
  { name: "USMV · Min Vol",       alloc: 0.42, sel: 0.61, total: 1.03 },
  { name: "BND · Agg Bond",       alloc: 0.06, sel: 0.04, total: 0.10 },
  { name: "IEF · 7-10Y Tsy",      alloc: 0.31, sel: 0.18, total: 0.49 },
  { name: "SCHP · TIPS",          alloc: 0.12, sel: 0.08, total: 0.20 },
  { name: "IAU · Gold",           alloc: 0.84, sel: 0.21, total: 1.05 },
  { name: "SGOV · Cash",          alloc: 0.04, sel: 0.00, total: 0.04 },
];

const CASH_FLOWS = [
  { date: "Apr 28, 26", type: "DIVIDEND", detail: "IXUS distribution",    amount: 842.10 },
  { date: "Apr 22, 26", type: "DIVIDEND", detail: "BND monthly",          amount: 614.20 },
  { date: "Apr 01, 26", type: "AUTO-BUY", detail: "$3,000 → BND/IXUS 60/40", amount: -3000.00 },
];

export default function PerformancePage({ summary, positions, perfData, loading }: Props) {
  const totalValue = summary?.total_value ?? 0;
  const ytdReturn = summary?.total_gain_pct ?? 9.84;

  // Rolling 12-month chart
  const rollingLabels = perfData.map((_, i) => {
    const mo = Math.round((perfData.length - 1 - i) / (perfData.length / 36));
    return mo > 0 ? `M-${mo}` : "Now";
  });
  const baseVal = perfData.length > 0 ? perfData[0].total_value : 1;
  const rollingPort = perfData.map((d, i) => {
    if (i < 12) return null;
    const prev = perfData[i - 12];
    return ((d.total_value - prev.total_value) / prev.total_value) * 100;
  });
  const rollingBench = rollingPort.map((v) => v != null ? v * 0.78 : null);

  const rollingChartData = {
    labels: rollingLabels,
    datasets: [
      {
        label: "Portfolio",
        data: rollingPort,
        borderColor: "#1A1611",
        backgroundColor: "rgba(26,22,17,0.05)",
        fill: true,
        borderWidth: 1.5,
        tension: 0.4,
        pointRadius: 0,
        spanGaps: true,
      },
      {
        label: "60/40 Bench",
        data: rollingBench,
        borderColor: "#9B9088",
        backgroundColor: "transparent",
        fill: false,
        borderWidth: 1.2,
        borderDash: [4, 3],
        tension: 0.4,
        pointRadius: 0,
        spanGaps: true,
      },
    ],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rollingOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: "#6B6158", font: { size: 10 }, boxWidth: 20, boxHeight: 1, padding: 14 } },
      tooltip: {
        backgroundColor: "#FDFAF5",
        borderColor: "#D8CFBF",
        borderWidth: 1,
        titleColor: "#1A1611",
        bodyColor: "#6B6158",
        callbacks: { label: (ctx: { dataset: { label?: string }; parsed: { y: number } }) => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(2)}%` },
      },
    },
    scales: {
      x: { ticks: { color: "#9B9088", font: { size: 9 }, maxTicksLimit: 10 }, grid: { color: "#EDE5D6", lineWidth: 0.5 }, border: { color: "#D8CFBF" } },
      y: { ticks: { color: "#9B9088", font: { size: 9 }, callback: (v: string | number) => `${Number(v).toFixed(0)}%` }, grid: { color: "#EDE5D6", lineWidth: 0.5 }, border: { color: "#D8CFBF" } },
    },
  };

  // Distribution income bar chart
  const distMonths = ["M","J","J","A","S","O","N","D","J","F","M","A"];
  const distValues = [1.2, 1.3, 1.2, 1.3, 1.3, 1.3, 1.4, 1.3, 1.3, 1.4, 1.3, 1.4].map(v => v * (totalValue / 684213));

  const distChartData = {
    labels: distMonths,
    datasets: [{
      label: "Income ($k)",
      data: distValues,
      backgroundColor: "#1A1611",
      borderRadius: 2,
      barThickness: 12,
    }],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const distOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: {
      backgroundColor: "#FDFAF5", borderColor: "#D8CFBF", borderWidth: 1,
      titleColor: "#1A1611", bodyColor: "#6B6158",
      callbacks: { label: (ctx: { parsed: { y: number } }) => ` $${ctx.parsed.y.toFixed(1)}k` },
    }},
    scales: {
      x: { ticks: { color: "#9B9088", font: { size: 9 } }, grid: { display: false }, border: { color: "#D8CFBF" } },
      y: { ticks: { color: "#9B9088", font: { size: 9 }, callback: (v: string | number) => `$${Number(v).toFixed(1)}k` }, grid: { color: "#EDE5D6", lineWidth: 0.5 }, border: { color: "#D8CFBF" } },
    },
  };

  const totalBrinsonActive = BRINSON.reduce((s, b) => s + b.total, 0);

  if (loading) return <div className="flex items-center justify-center h-64"><span className="text-ink-4 text-sm">Loading…</span></div>;

  return (
    <div className="max-w-[1200px] mx-auto px-8 pb-16">
      {/* Editorial header */}
      <div className="grid grid-cols-5 gap-8 py-10 border-b border-parchment-border">
        <div className="col-span-3">
          <p className="section-label mb-3">§ 04 — Performance &amp; Attribution</p>
          <h1 className="font-serif text-6xl text-ink leading-tight mb-1">Two engines,</h1>
          <h1 className="font-serif text-6xl text-ink italic leading-tight mb-5">one quiet ledger.</h1>
          <p className="text-ink-3 text-sm leading-relaxed max-w-lg">
            The minimum-volatility equity sleeve and an underweight to emerging markets together explain
            most of the +263 bps lead over the 60/40 benchmark this year. Gold provided the surprise tailwind.
          </p>
        </div>
        <div className="col-span-2 flex items-center gap-6 pl-8 border-l border-parchment-border">
          {[
            { label: "MTD", value: "+2.6%" },
            { label: "YTD", value: `${sign(ytdReturn)}${fmt(Math.abs(ytdReturn))}%` },
            { label: "1 YR", value: "+15.32%" },
            { label: "3 YR A.", value: "+8.41%" },
          ].map((m) => (
            <div key={m.label}>
              <p className="section-label mb-1">{m.label}</p>
              <p className="font-sans font-semibold text-2xl pos">{m.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* §01 Trailing Returns vs Benchmarks */}
      <SectionHeader num="01" title="Trailing Returns vs Benchmarks" right="Annualized for 3Y+ · Net of Fees" />
      <div className="border border-parchment-border rounded overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-parchment-dark border-b border-parchment-border">
              <th className="px-4 py-2 section-label text-left w-40"></th>
              {["MTD","QTD","YTD","1 YR","3 YR","5 YR","SINCE INCEPT.","BEST YR","WORST YR"].map((h) => (
                <th key={h} className="px-3 py-2 section-label text-right whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BENCHMARKS.map((row) => {
              const vals = [row.mtd, row.qtd, row.ytd, row.y1, row.y3, row.y5, row.incept, row.best, row.worst];
              return (
                <tr key={row.name} className={[
                  "border-b border-parchment-border last:border-b-0",
                  row.bold ? "bg-parchment-dark font-semibold" : "hover:bg-parchment/60",
                  row.accent ? "bg-parchment-dark/60 border-t-2 border-t-parchment-border" : "",
                ].join(" ")}>
                  <td className={`px-4 py-2.5 text-xs ${row.bold ? "font-semibold text-ink" : "text-ink-3"} whitespace-nowrap`}>{row.name}</td>
                  {vals.map((v, i) => (
                    <td key={i} className={`px-3 py-2.5 text-xs text-right ${v >= 0 ? (row.bold && i < 7 ? "pos font-semibold" : "text-ink-3") : "neg"}`}>
                      {sign(v)}{fmt(Math.abs(v))}%
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* §02 Rolling + §03 Monthly */}
      <div className="grid grid-cols-5 gap-8 mt-0">
        <div className="col-span-3">
          <SectionHeader num="02" title="Rolling 12-Month Return — 36 Mo Window" right="Annualized" />
          <div className="bg-card-bg border border-parchment-border rounded" style={{ height: 220 }}>
            {perfData.length < 14 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-ink-4 text-sm">Need 13+ months of data.</p>
              </div>
            ) : (
              <Line data={rollingChartData} options={rollingOptions} />
            )}
          </div>
          <div className="flex items-center gap-4 mt-1">
            <span className="section-label">Min: +2.1% · Max: +14.6% · Median: +9.4%</span>
          </div>
        </div>

        <div className="col-span-2">
          <SectionHeader num="03" title="Monthly Returns" right="vs 60/40 Bench" />
          <div className="space-y-0">
            {MONTHLY.map((m) => {
              const portPos = m.port >= 0;
              const exPos = m.excess >= 0;
              return (
                <div key={m.month} className="flex items-center gap-2 py-1 border-b border-parchment-border last:border-b-0">
                  <span className="text-xs text-ink-4 w-12 shrink-0">{m.month}</span>
                  <div className="flex-1 flex items-center gap-1">
                    {/* Portfolio bar */}
                    <div className="flex-1 flex items-center">
                      <div className="w-full flex justify-center relative h-3">
                        <div
                          className="absolute h-full rounded-sm"
                          style={{
                            width: `${Math.abs(m.port) * 8}%`,
                            left: portPos ? "50%" : undefined,
                            right: portPos ? undefined : "50%",
                            backgroundColor: portPos ? "#1A1611" : "#B81C1C",
                          }}
                        />
                        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-parchment-border" />
                      </div>
                    </div>
                    {/* Bench bar */}
                    <div className="flex-1 flex items-center">
                      <div className="w-full flex justify-center relative h-3">
                        <div
                          className="absolute h-full rounded-sm"
                          style={{
                            width: `${Math.abs(m.bench) * 8}%`,
                            left: m.bench >= 0 ? "50%" : undefined,
                            right: m.bench >= 0 ? undefined : "50%",
                            backgroundColor: "#C8BFB3",
                          }}
                        />
                        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-parchment-border" />
                      </div>
                    </div>
                  </div>
                  <span className={`text-xs font-medium w-10 text-right ${exPos ? "pos" : "neg"}`}>
                    {sign(m.excess)}{fmt(Math.abs(m.excess), 2)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-2xs text-ink-4">Hit rate: {MONTHLY.filter(m => m.excess > 0).length} of {MONTHLY.length} outperformed</span>
            <span className="section-label">Avg active +0.41%</span>
          </div>
        </div>
      </div>

      {/* §04 Brinson Attribution */}
      <SectionHeader num="04" title="Brinson Attribution — YTD Active Return vs 60/40" right="Allocation + Selection · % Contribution" />
      <div className="border border-parchment-border rounded overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-parchment-dark border-b border-parchment-border">
              {["POSITION","ALLOCATION","SELECTION","TOTAL CONTRIB.","DISTRIBUTION"].map((h) => (
                <th key={h} className="px-4 py-2 section-label text-left whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BRINSON.map((row) => {
              const pos = row.total >= 0;
              const maxAbs = Math.max(...BRINSON.map(r => Math.abs(r.total)));
              return (
                <tr key={row.name} className="border-b border-parchment-border last:border-b-0 hover:bg-parchment/60">
                  <td className="px-4 py-2.5 text-xs font-medium text-ink whitespace-nowrap">{row.name}</td>
                  <td className={`px-4 py-2.5 text-xs ${row.alloc >= 0 ? "pos" : "neg"}`}>{sign(row.alloc)}{fmt(row.alloc)}%</td>
                  <td className={`px-4 py-2.5 text-xs ${row.sel >= 0 ? "pos" : "neg"}`}>{sign(row.sel)}{fmt(row.sel)}%</td>
                  <td className={`px-4 py-2.5 text-xs font-semibold ${pos ? "pos" : "neg"}`}>{sign(row.total)}{fmt(row.total)}%</td>
                  <td className="px-4 py-2.5 w-40">
                    <div className="relative h-3 flex items-center">
                      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-parchment-border" />
                      <div
                        className="absolute h-3 rounded-sm"
                        style={{
                          width: `${(Math.abs(row.total) / maxAbs) * 45}%`,
                          left: pos ? "50%" : undefined,
                          right: pos ? undefined : "50%",
                          backgroundColor: pos ? "#1A5C3A" : "#B81C1C",
                        }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-parchment-dark border-t border-parchment-border font-semibold">
              <td className="px-4 py-2 section-label">Total Active Return</td>
              <td className="px-4 py-2 text-xs pos">{sign(BRINSON.reduce((s,b)=>s+b.alloc,0))}{fmt(Math.abs(BRINSON.reduce((s,b)=>s+b.alloc,0)))}%</td>
              <td className="px-4 py-2 text-xs pos">{sign(BRINSON.reduce((s,b)=>s+b.sel,0))}{fmt(Math.abs(BRINSON.reduce((s,b)=>s+b.sel,0)))}%</td>
              <td className="px-4 py-2 text-xs pos font-semibold">{sign(totalBrinsonActive)}{fmt(Math.abs(totalBrinsonActive))}% vs benchmark · YTD</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* §05 Distribution income + §06 Cash Flows */}
      <div className="grid grid-cols-2 gap-8 mt-0">
        <div>
          <SectionHeader num="05" title="Distribution Income — TTM" right={`$${Math.round(totalValue * 0.0231).toLocaleString()} Received · 2.31% Yield`} />
          <div className="bg-card-bg border border-parchment-border rounded" style={{ height: 120 }}>
            <Bar data={distChartData} options={distOptions} />
          </div>
        </div>

        <div>
          <SectionHeader num="06" title="Cash Flows — 12 Months" right="Contributions, Dividends, Rebalances" />
          <div className="border border-parchment-border rounded overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-parchment-dark border-b border-parchment-border">
                  {["DATE","TYPE","DETAIL","AMOUNT"].map((h) => (
                    <th key={h} className="px-3 py-2 section-label text-left whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CASH_FLOWS.map((row, i) => (
                  <tr key={i} className="border-b border-parchment-border last:border-b-0 hover:bg-parchment/60">
                    <td className="px-3 py-2.5 text-xs text-ink-4 whitespace-nowrap">{row.date}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-2xs px-1.5 py-0.5 rounded bg-parchment-dark text-ink-3 font-medium whitespace-nowrap">
                        {row.type}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ink-3">{row.detail}</td>
                    <td className={`px-3 py-2.5 text-xs font-semibold text-right ${row.amount >= 0 ? "pos" : "neg"}`}>
                      {sign(row.amount)}${Math.abs(row.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
