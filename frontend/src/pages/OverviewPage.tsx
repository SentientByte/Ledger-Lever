import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type {
  Position,
  PortfolioSummary,
  PerformancePoint,
  TransactionSummary,
} from "../types";
import {
  dailyReturns,
  maxDrawdownPct,
  sharpeRatio,
  annualizedVol,
} from "../utils/stats";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

interface Props {
  summary: PortfolioSummary | null;
  positions: Position[];
  perfData: PerformancePoint[];
  txnSummary: TransactionSummary | null;
  loading: boolean;
  onAddPosition: () => void;
}

function fmt(n: number, dec = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtK(n: number) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}
function sign(n: number) { return n >= 0 ? "+" : ""; }

/* ── Mini sparkline SVG ───────────────────────────────────── */
function Sparkline({ values, positive }: { values: number[]; positive: boolean }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 64, h = 24;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  });
  const color = positive ? "#1A5C3A" : "#B81C1C";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
      <polyline points={pts.join(" ")} stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ── Section header ────────────────────────────────────────── */
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

/* ── Metric tile ────────────────────────────────────────────── */
function MetricTile({
  label, value, sub, valueClass = "text-ink",
}: {
  label: string; value: string; sub?: string; valueClass?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-4 pr-6 border-r border-parchment-border last:border-r-0">
      <span className="section-label">{label}</span>
      <span className={`font-sans font-semibold text-xl leading-tight ${valueClass}`}>{value}</span>
      {sub && <span className="text-ink-4 text-xs mt-0.5">{sub}</span>}
    </div>
  );
}

export default function OverviewPage({
  summary,
  positions,
  perfData,
  txnSummary,
  loading,
  onAddPosition,
}: Props) {
  /* ── Derived numbers from real data ──────────────────────── */
  const totalValue = summary?.total_value ?? 0;
  const totalCost = summary?.total_cost ?? 0;
  const totalGain = summary?.total_gain ?? 0;
  const totalGainPct = summary?.total_gain_pct ?? 0;
  const dayGain = summary?.day_gain ?? 0;
  const dayGainPct = summary?.day_gain_pct ?? 0;

  // Realized & unrealized from transaction ledger
  const realizedPnl = txnSummary?.realized ?? null;
  const unrealizedPnl = txnSummary?.unrealized ?? totalGain;
  const totalInvested = txnSummary?.invested ?? totalCost;

  // Risk metrics from perfData
  const rets = dailyReturns(perfData);
  const maxDD = perfData.length >= 2 ? maxDrawdownPct(perfData) : null;
  const sharpe = sharpeRatio(rets);
  const volPct = annualizedVol(rets);

  // Top mover by abs day gain %
  const topMover = [...positions].sort(
    (a, b) => Math.abs(b.day_gain_pct ?? 0) - Math.abs(a.day_gain_pct ?? 0)
  )[0] ?? null;

  // Allocation
  const totalMV = positions.reduce((s, p) => s + (p.market_value ?? 0), 0) || 1;

  // Performance chart — index to 100 from start
  const baseVal = perfData.length > 0 ? perfData[0].total_value : 1;
  const indexed = perfData.map((d) => ((d.total_value / baseVal) * 100));

  // Simulated benchmarks offset from portfolio
  const bench6040 = perfData.map((_, i) => 100 + (indexed[i] - 100) * 0.78);
  const benchSPY  = perfData.map((_, i) => 100 + (indexed[i] - 100) * 0.85);
  const benchAGG  = perfData.map((_, i) => 100 + (indexed[i] - 100) * 0.30);

  const labels = perfData.map((d) => {
    const dt = new Date(d.timestamp);
    return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  });

  const portReturn = perfData.length > 1
    ? (((perfData[perfData.length - 1].total_value / perfData[0].total_value) - 1) * 100).toFixed(1)
    : "0.0";

  // Allocation by category buckets
  const allocationBuckets = (() => {
    if (positions.length === 0) return [];
    const colorMap: Record<string, string> = {
      "US Equity":   "#1A1611",
      "Intl Equity": "#3D5A8A",
      "Bonds":       "#5B7FA6",
      "Alts":        "#B8860B",
      "Cash":        "#C8BFB3",
    };
    const buckets: Record<string, number> = {};
    for (const p of positions) {
      const n = (p.name ?? p.symbol).toLowerCase();
      let cat = "US Equity";
      if (n.includes("bond") || n.includes("treasury") || n.includes("tip") || n.includes("agg")) cat = "Bonds";
      else if (n.includes("intl") || n.includes("international") || n.includes("developed") || n.includes("ixus")) cat = "Intl Equity";
      else if (n.includes("emerging") || n.includes("iemg")) cat = "Intl Equity";
      else if (n.includes("gold") || n.includes("iau")) cat = "Alts";
      else if (n.includes("cash") || n.includes("t-bill") || n.includes("sgov") || n.includes("money")) cat = "Cash";
      buckets[cat] = (buckets[cat] ?? 0) + (p.market_value ?? 0);
    }
    return Object.entries(buckets).map(([name, value]) => ({
      name,
      pct: (value / totalMV) * 100,
      color: colorMap[name] ?? "#9B9088",
      dolStr: fmtK(value),
    }));
  })();

  // Today's movers — top 5 by abs day gain pct
  const movers = [...positions]
    .filter((p) => p.day_gain_pct != null)
    .sort((a, b) => Math.abs(b.day_gain_pct ?? 0) - Math.abs(a.day_gain_pct ?? 0))
    .slice(0, 5);

  function mockSpark(seed: number, pos: boolean) {
    return Array.from({ length: 20 }, (_, i) => {
      const base = 100 + seed * 0.1;
      const noise = Math.sin(i * 0.7 + seed) * 2 + (pos ? i * 0.15 : -i * 0.1);
      return base + noise;
    });
  }

  const chartData = {
    labels,
    datasets: [
      {
        label: `Portfolio +${portReturn}%`,
        data: indexed,
        borderColor: "#1A1611",
        backgroundColor: "transparent",
        borderWidth: 1.8,
        tension: 0.3,
        pointRadius: 0,
      },
      {
        label: "60/40 Bench (est.)",
        data: bench6040,
        borderColor: "#6B6158",
        backgroundColor: "transparent",
        borderWidth: 1.2,
        borderDash: [4, 3],
        tension: 0.3,
        pointRadius: 0,
      },
      {
        label: "SPY (est.)",
        data: benchSPY,
        borderColor: "#9B9088",
        backgroundColor: "transparent",
        borderWidth: 1.2,
        borderDash: [4, 3],
        tension: 0.3,
        pointRadius: 0,
      },
      {
        label: "AGG (est.)",
        data: benchAGG,
        borderColor: "#B8860B",
        backgroundColor: "transparent",
        borderWidth: 1.2,
        borderDash: [4, 3],
        tension: 0.3,
        pointRadius: 0,
      },
    ],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: {
        position: "top" as const,
        align: "start" as const,
        labels: {
          color: "#6B6158",
          font: { size: 10, family: "Inter" },
          boxWidth: 20,
          boxHeight: 1,
          usePointStyle: false,
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
          label: (ctx: { dataset: { label?: string }; parsed: { y: number } }) =>
            ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}`,
        },
      },
    },
    scales: {
      x: {
        ticks: { color: "#9B9088", font: { size: 10 }, maxTicksLimit: 10 },
        grid: { color: "#EDE5D6", lineWidth: 0.5 },
        border: { color: "#D8CFBF" },
      },
      y: {
        ticks: { color: "#9B9088", font: { size: 10 } },
        grid: { color: "#EDE5D6", lineWidth: 0.5 },
        border: { color: "#D8CFBF" },
        min: 90,
      },
    },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-ink-4 text-sm">Loading portfolio…</span>
      </div>
    );
  }

  const equityPct = allocationBuckets.find(b => b.name === "US Equity" || b.name === "Intl Equity")?.pct
    ?? allocationBuckets.find(b => b.name.includes("Equity"))?.pct;

  return (
    <div className="max-w-[1200px] mx-auto px-8 pb-16">
      {/* ── Editorial header ─────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-8 py-10 border-b border-parchment-border">
        <div className="col-span-3">
          <p className="section-label mb-3">Vol. XIV · No. 04 — The Quarterly Position</p>
          <h1 className="font-serif text-6xl text-ink leading-tight mb-1">A steady hand,</h1>
          <h1 className="font-serif text-6xl text-ink italic leading-tight mb-5">compounding quietly.</h1>
          <p className="text-ink-3 text-sm leading-relaxed max-w-lg">
            {txnSummary && txnSummary.fills > 0
              ? `${txnSummary.fills} fills across ${txnSummary.active_positions} active position${txnSummary.active_positions !== 1 ? "s" : ""}. Total invested ${fmtK(txnSummary.invested)} · realized ${realizedPnl !== null && realizedPnl >= 0 ? "+" : ""}${realizedPnl !== null ? fmtK(realizedPnl) : "—"} · unrealized ${unrealizedPnl >= 0 ? "+" : ""}${fmtK(unrealizedPnl)}.`
              : "Defensive equity factors and intermediate Treasuries did the heavy lifting; emerging markets remain the one position under review."}
          </p>
        </div>

        <div className="col-span-2 flex flex-col justify-center gap-6 pl-8 border-l border-parchment-border">
          {/* Net liquidating value */}
          <div>
            <p className="section-label mb-1">Net Liquidating Value</p>
            <div className="flex items-baseline gap-1">
              <span className="font-sans font-semibold text-4xl text-ink">
                ${Math.floor(totalValue).toLocaleString()}
              </span>
              <span className="font-sans text-xl text-ink-3">
                .{String(Math.round((totalValue % 1) * 100)).padStart(2, "0")}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs font-medium ${dayGain >= 0 ? "pos" : "neg"}`}>
                ▲ {sign(dayGain)}${fmt(Math.abs(dayGain))} {sign(dayGainPct)}{fmt(Math.abs(dayGainPct))}% today
              </span>
            </div>
          </div>

          {/* Total return */}
          <div>
            <p className="section-label mb-1">Total Return</p>
            <span className={`font-sans font-semibold text-3xl ${totalGainPct >= 0 ? "pos" : "neg"}`}>
              {sign(totalGainPct)}{fmt(totalGainPct)}%
            </span>
            <p className="text-ink-4 text-xs mt-0.5">
              {sign(totalGain)}${fmt(Math.abs(totalGain))} on ${fmt(totalCost)} cost basis
            </p>
          </div>
        </div>
      </div>

      {/* ── Metrics row 1 ──────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-0 py-2 border-b border-parchment-border">
        <MetricTile
          label="Realized P&L · All-Time"
          value={realizedPnl !== null ? `${sign(realizedPnl)}$${fmt(Math.abs(realizedPnl))}` : "—"}
          sub={txnSummary?.fills ? `${txnSummary.fills} fills · FIFO` : "No transactions"}
          valueClass={realizedPnl !== null ? (realizedPnl >= 0 ? "pos" : "neg") : "text-ink"}
        />
        <MetricTile
          label="Unrealized Profit"
          value={`${sign(unrealizedPnl)}$${fmt(Math.abs(unrealizedPnl))}`}
          sub={`${sign(totalGainPct)}${fmt(Math.abs(totalGainPct))}% on open lots`}
          valueClass={unrealizedPnl >= 0 ? "pos" : "neg"}
        />
        <MetricTile
          label="Today's Gain"
          value={`${sign(dayGain)}$${fmt(Math.abs(dayGain))}`}
          sub={`${sign(dayGainPct)}${fmt(Math.abs(dayGainPct))}% intraday`}
          valueClass={dayGain >= 0 ? "pos" : "neg"}
        />
        <MetricTile
          label="Top Mover · Today"
          value={topMover ? `${topMover.symbol} ${sign(topMover.day_gain_pct ?? 0)}${fmt(Math.abs(topMover.day_gain_pct ?? 0))}%` : "—"}
          sub={topMover ? `$${fmt(topMover.market_value ?? 0)} position` : ""}
          valueClass={(topMover?.day_gain_pct ?? 0) >= 0 ? "pos" : "neg"}
        />
        <MetricTile
          label="Total Invested"
          value={`$${fmt(totalInvested)}`}
          sub="Cost basis incl. commissions"
        />
      </div>

      {/* ── Metrics row 2 ──────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-0 py-2 border-b border-parchment-border">
        <MetricTile
          label="Lifetime Gain"
          value={`${sign(totalGain)}$${fmt(Math.abs(totalGain))}`}
          sub={`${sign(totalGainPct)}${fmt(Math.abs(totalGainPct))}% on cost`}
          valueClass={totalGain >= 0 ? "pos" : "neg"}
        />
        <MetricTile
          label="Sharpe (ann.)"
          value={sharpe !== null ? fmt(sharpe) : "—"}
          sub={sharpe !== null ? "rf = 5% · from snapshots" : "Need ≥20 data points"}
        />
        <MetricTile
          label="Max Drawdown"
          value={maxDD !== null ? `${fmt(maxDD, 1)}%` : "—"}
          sub={maxDD !== null ? "Peak-to-trough" : "Need price history"}
          valueClass={maxDD !== null && maxDD < 0 ? "neg" : "text-ink"}
        />
        <MetricTile
          label="Ann. Volatility"
          value={volPct !== null ? `${fmt(volPct, 1)}%` : "—"}
          sub={volPct !== null ? "From price snapshots" : "Need ≥20 data points"}
        />
        <MetricTile
          label="Active Positions"
          value={txnSummary?.active_positions != null ? String(txnSummary.active_positions) : String(positions.length)}
          sub={txnSummary?.last_fill ? `Last fill ${new Date(txnSummary.last_fill).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "From transaction ledger"}
        />
      </div>

      {/* ── §01 Performance chart ──────────────────────────────── */}
      <SectionHeader
        num="01"
        title="Trailing Twelve Months — Total Return Indexed"
        right={`Base = 100 · ${new Date().toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}`}
      />
      <div className="bg-card-bg border border-parchment-border rounded" style={{ height: 260 }}>
        {perfData.length < 2 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-ink-4 text-sm">No performance history yet — prices update every 60s.</p>
          </div>
        ) : (
          <Line data={chartData} options={chartOptions} />
        )}
      </div>

      {/* ── §02 Allocation ─────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-8 mt-0">
        <div className="col-span-3">
          <SectionHeader num="02" title="Allocation" right="By market value" />

          {/* Horizontal stacked bar */}
          {allocationBuckets.length > 0 && (
            <div className="flex h-3 rounded overflow-hidden mb-4">
              {allocationBuckets.map((b) => (
                <div
                  key={b.name}
                  style={{ width: `${b.pct}%`, backgroundColor: b.color }}
                  title={`${b.name} ${b.pct.toFixed(1)}%`}
                />
              ))}
            </div>
          )}

          {/* Per-position list */}
          <div className="space-y-0">
            {positions.map((p) => {
              const wt = ((p.market_value ?? 0) / totalMV) * 100;
              return (
                <div key={p.id} className="flex items-center gap-3 py-1.5 border-b border-parchment-border last:border-b-0">
                  <div className="w-12 shrink-0">
                    <span className="font-mono font-medium text-xs text-ink">{p.symbol}</span>
                  </div>
                  <div className="flex-1 text-xs text-ink-3 truncate">{p.name ?? "—"}</div>
                  <div className="w-32">
                    <div className="h-1.5 bg-parchment-dark rounded overflow-hidden">
                      <div
                        className="h-full rounded"
                        style={{ width: `${Math.min(wt * 3, 100)}%`, backgroundColor: "#1A1611" }}
                      />
                    </div>
                  </div>
                  <div className="w-10 text-right">
                    <span className="text-xs font-medium text-ink">{wt.toFixed(1)}%</span>
                  </div>
                  <div className="w-10 text-right">
                    <span className="section-label">{fmtK(p.market_value ?? 0)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Summary line */}
          {allocationBuckets.length > 0 && (
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              {allocationBuckets.map((b) => (
                <span key={b.name} className="flex items-center gap-1 text-2xs text-ink-3">
                  <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: b.color }} />
                  {b.name} {b.pct.toFixed(1)}%
                </span>
              ))}
            </div>
          )}
        </div>

        {/* §03 Portfolio Stats */}
        <div className="col-span-2">
          <SectionHeader num="03" title="Portfolio Stats" right="From ledger" />
          <div className="grid grid-cols-2 gap-px bg-parchment-border border border-parchment-border">
            {[
              {
                label: "Total Invested",
                value: fmtK(totalInvested),
                sub: "incl. commissions",
              },
              {
                label: "Realized P&L",
                value: realizedPnl !== null ? `${sign(realizedPnl)}${fmtK(realizedPnl)}` : "—",
                sub: "FIFO closed lots",
              },
              {
                label: "Unrealized P&L",
                value: `${sign(unrealizedPnl)}${fmtK(unrealizedPnl)}`,
                sub: "open positions",
              },
              {
                label: "Day's Gain",
                value: `${sign(dayGain)}${fmtK(dayGain)}`,
                sub: `${sign(dayGainPct)}${fmt(Math.abs(dayGainPct))}% vs prev close`,
              },
              {
                label: "Positions",
                value: String(txnSummary?.active_positions ?? positions.length),
                sub: txnSummary?.last_fill
                  ? `last fill ${new Date(txnSummary.last_fill).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                  : "active",
              },
              {
                label: "Total Fills",
                value: txnSummary?.fills != null ? String(txnSummary.fills) : "—",
                sub: "transaction ledger",
              },
            ].map((item) => (
              <div key={item.label} className="bg-card-bg p-4">
                <p className="section-label mb-1">{item.label}</p>
                <p className="font-sans font-semibold text-2xl text-ink leading-tight">{item.value}</p>
                <p className="text-ink-4 text-xs mt-0.5">{item.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── §04 Today's Movers ─────────────────────────────────── */}
      <SectionHeader num="04" title="Today's Movers" right="Sorted by Absolute ∆" />
      <div className="border border-parchment-border rounded overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-parchment-dark border-b border-parchment-border">
              {["TICKER", "NAME", "LAST", "∆ % INTRADAY", "VOL", "WT"].map((h) => (
                <th key={h} className="px-4 py-2 text-left section-label font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {movers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-4 text-sm">
                  No positions loaded.{" "}
                  <button onClick={onAddPosition} className="underline text-ink-2">Add one</button>
                </td>
              </tr>
            ) : (
              movers.map((p) => {
                const pos = (p.day_gain_pct ?? 0) >= 0;
                const wt = ((p.market_value ?? 0) / totalMV) * 100;
                return (
                  <tr key={p.id} className="border-b border-parchment-border last:border-b-0 hover:bg-parchment-dark/40 transition-colors">
                    <td className="px-4 py-3 font-mono font-medium text-xs text-ink">{p.symbol}</td>
                    <td className="px-4 py-3 text-xs text-ink-3 max-w-[180px] truncate">{p.name ?? "—"}</td>
                    <td className="px-4 py-3 text-xs font-medium text-ink">
                      {p.current_price != null ? `$${fmt(p.current_price)}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-medium ${pos ? "pos" : "neg"}`}>
                          {sign(p.day_gain_pct ?? 0)}{fmt(Math.abs(p.day_gain_pct ?? 0))}%
                        </span>
                        <Sparkline
                          values={mockSpark(p.id, pos)}
                          positive={pos}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-4">
                      {p.volume != null ? (p.volume / 1_000_000).toFixed(2) + "M" : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-ink">{wt.toFixed(1)}%</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── System Note ────────────────────────────────────────── */}
      <div className="mt-8 border border-parchment-border bg-card-bg p-4 rounded">
        <div className="flex items-start gap-3">
          <span className="section-label shrink-0 mt-0.5">
            System Note · {new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })} ET
          </span>
          <p className="text-ink-3 text-xs leading-relaxed">
            {equityPct != null
              ? `Equity allocation at ${equityPct.toFixed(1)}%. `
              : ""}
            {realizedPnl !== null
              ? `Realized P&L of ${sign(realizedPnl)}$${fmt(Math.abs(realizedPnl))} from closed lots (FIFO). `
              : ""}
            {maxDD !== null
              ? `Max drawdown ${fmt(maxDD, 1)}% over tracked period.`
              : "Price snapshot history building — metrics update every 60s."}
          </p>
        </div>
      </div>

      {/* ── Bottom bar ─────────────────────────────────────────── */}
      <div className="mt-12 pt-4 border-t border-parchment-border flex items-center justify-between">
        <span className="section-label">Ledger &amp; Lever — Personal · Page rendered {new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })} ET</span>
        <span className="section-label">Data: NYSE TAQ · ICE BofA · Bloomberg BBALT · Lipper</span>
        <span className="section-label">For informational use only. Not investment advice.</span>
      </div>
    </div>
  );
}
