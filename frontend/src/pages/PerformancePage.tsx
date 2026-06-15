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
import type {
  Position,
  PortfolioSummary,
  PerformancePoint,
  TransactionSummary,
  BarsResult,
} from "../types";
import {
  monthlyReturns,
  periodReturn,
  annualizedReturnPct,
  maxDrawdownPct,
  barPeriodReturn,
  indexBars,
} from "../utils/stats";

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
  txnSummary: TransactionSummary | null;
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

function sign(n: number) {
  return n >= 0 ? "+" : "";
}
function fmt(n: number, dec = 2) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}
function fmtNull(n: number | null, dec = 2, suffix = "%") {
  if (n === null) return "—";
  return `${sign(n)}${fmt(Math.abs(n), dec)}${suffix}`;
}


export default function PerformancePage({
  summary,
  perfData,
  txnSummary,
  barsData,
  loading,
}: Props) {
  const totalValue = summary?.total_value ?? 0;
  const totalCost = summary?.total_cost ?? 0;

  // ── Computed period returns from real perfData ────────────
  const mtd = periodReturn(perfData, "MTD");
  const qtd = periodReturn(perfData, "QTD");
  const ytd = periodReturn(perfData, "YTD");
  const annRet = annualizedReturnPct(perfData);
  const maxDD = perfData.length >= 2 ? maxDrawdownPct(perfData) : null;

  // Total return since inception (cost basis perspective)
  const totalReturnPct =
    totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : null;

  // Monthly returns from perfData (last 12 months)
  const computedMonthly = monthlyReturns(perfData, 12);

  // Real benchmark bars
  const spyBars = barsData["SPY"] ?? [];
  const aggBars = barsData["AGG"] ?? [];

  // Live benchmark period returns
  const spyMtd = barPeriodReturn(spyBars, "MTD");
  const spyQtd = barPeriodReturn(spyBars, "QTD");
  const spyYtd = barPeriodReturn(spyBars, "YTD");
  const aggMtd = barPeriodReturn(aggBars, "MTD");
  const aggQtd = barPeriodReturn(aggBars, "QTD");
  const aggYtd = barPeriodReturn(aggBars, "YTD");

  // Best/worst month for benchmarks (from available bars)
  function bestWorstMonth(bars: typeof spyBars): { best: number | null; worst: number | null } {
    if (bars.length < 2) return { best: null, worst: null };
    const byMonth: Record<string, { first: number; last: number }> = {};
    for (const b of bars) {
      const key = b.date.slice(0, 7);
      if (!byMonth[key]) byMonth[key] = { first: b.close, last: b.close };
      else byMonth[key].last = b.close;
    }
    const returns = Object.values(byMonth).map(({ first, last }) =>
      first > 0 ? ((last - first) / first) * 100 : 0
    );
    if (returns.length === 0) return { best: null, worst: null };
    return { best: Math.max(...returns), worst: Math.min(...returns) };
  }
  const spyBestWorst = bestWorstMonth(spyBars);
  const aggBestWorst = bestWorstMonth(aggBars);

  // SPY total return over available bars
  const spyTotalReturn = spyBars.length >= 2
    ? ((spyBars[spyBars.length - 1].close - spyBars[0].close) / spyBars[0].close) * 100
    : null;
  const aggTotalReturn = aggBars.length >= 2
    ? ((aggBars[aggBars.length - 1].close - aggBars[0].close) / aggBars[0].close) * 100
    : null;

  // 60/40 totals
  const bench6040Mtd = (spyMtd != null && aggMtd != null) ? 0.6 * spyMtd + 0.4 * aggMtd : null;
  const bench6040Qtd = (spyQtd != null && aggQtd != null) ? 0.6 * spyQtd + 0.4 * aggQtd : null;
  const bench6040Ytd = (spyYtd != null && aggYtd != null) ? 0.6 * spyYtd + 0.4 * aggYtd : null;
  const bench6040Total = (spyTotalReturn != null && aggTotalReturn != null)
    ? 0.6 * spyTotalReturn + 0.4 * aggTotalReturn : null;

  const BENCH_REAL = [
    {
      name: "60/40 (SPY+AGG)",
      mtd: bench6040Mtd,
      qtd: bench6040Qtd,
      ytd: bench6040Ytd,
      total: bench6040Total,
      best: null as number | null,
      worst: null as number | null,
    },
    {
      name: "S&P 500 (SPY)",
      mtd: spyMtd,
      qtd: spyQtd,
      ytd: spyYtd,
      total: spyTotalReturn,
      best: spyBestWorst.best,
      worst: spyBestWorst.worst,
    },
    {
      name: "US Agg (AGG)",
      mtd: aggMtd,
      qtd: aggQtd,
      ytd: aggYtd,
      total: aggTotalReturn,
      best: aggBestWorst.best,
      worst: aggBestWorst.worst,
    },
  ];

  // Rolling 12-month chart from perfData
  const rollingLabels = perfData.map((_, i) => {
    const mo = Math.round(
      (perfData.length - 1 - i) / (perfData.length / 36)
    );
    return mo > 0 ? `M-${mo}` : "Now";
  });
  const rollingPort = perfData.map((d, i) => {
    if (i < 12) return null;
    const prev = perfData[i - 12];
    return prev.total_value > 0
      ? ((d.total_value - prev.total_value) / prev.total_value) * 100
      : null;
  });

  // Real SPY rolling 12-month return aligned with perfData dates
  const perfStartDate = perfData.length > 0 ? perfData[0].timestamp.slice(0, 10) : "";
  const indexedSpy = perfStartDate ? indexBars(spyBars, perfStartDate) : [];
  const spyByDate = new Map(indexedSpy.map((b) => [b.date, b.value]));
  const rollingBench = perfData.map((d, i) => {
    if (i < 12) return null;
    const prev = perfData[i - 12];
    const dateNow = d.timestamp.slice(0, 10);
    const datePrev = prev.timestamp.slice(0, 10);
    // Find nearest SPY value for this date
    const spyNow = spyByDate.get(dateNow) ?? null;
    const spyPrev = spyByDate.get(datePrev) ?? null;
    if (spyNow != null && spyPrev != null && spyPrev > 0) {
      return ((spyNow - spyPrev) / spyPrev) * 100;
    }
    return null;
  });

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
        label: "SPY (rolling 12mo)",
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
      legend: {
        labels: {
          color: "#6B6158",
          font: { size: 10 },
          boxWidth: 20,
          boxHeight: 1,
          padding: 14,
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
          }) => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(2)}%`,
        },
      },
    },
    scales: {
      x: {
        ticks: {
          color: "#9B9088",
          font: { size: 9 },
          maxTicksLimit: 10,
        },
        grid: { color: "#EDE5D6", lineWidth: 0.5 },
        border: { color: "#D8CFBF" },
      },
      y: {
        ticks: {
          color: "#9B9088",
          font: { size: 9 },
          callback: (v: string | number) => `${Number(v).toFixed(0)}%`,
        },
        grid: { color: "#EDE5D6", lineWidth: 0.5 },
        border: { color: "#D8CFBF" },
      },
    },
  };

  // ── Monthly bar chart data ────────────────────────────────
  const monthlyBarData = {
    labels: computedMonthly.map((m) => m.label),
    datasets: [
      {
        label: "Portfolio %",
        data: computedMonthly.map((m) => m.pct),
        backgroundColor: computedMonthly.map((m) =>
          m.pct >= 0 ? "#1A1611" : "#B81C1C"
        ),
        borderRadius: 2,
        barThickness: 12,
      },
    ],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const monthlyBarOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#FDFAF5",
        borderColor: "#D8CFBF",
        borderWidth: 1,
        titleColor: "#1A1611",
        bodyColor: "#6B6158",
        callbacks: {
          label: (ctx: { parsed: { y: number } }) =>
            ` ${sign(ctx.parsed.y)}${ctx.parsed.y.toFixed(2)}%`,
        },
      },
    },
    scales: {
      x: {
        ticks: { color: "#9B9088", font: { size: 9 } },
        grid: { display: false },
        border: { color: "#D8CFBF" },
      },
      y: {
        ticks: {
          color: "#9B9088",
          font: { size: 9 },
          callback: (v: string | number) => `${Number(v).toFixed(1)}%`,
        },
        grid: { color: "#EDE5D6", lineWidth: 0.5 },
        border: { color: "#D8CFBF" },
      },
    },
  };

  // ── Rolling stats from computed monthly ──────────────────
  const monthlyPcts = computedMonthly.map((m) => m.pct);
  const rollingMin =
    monthlyPcts.length > 0 ? Math.min(...monthlyPcts) : null;
  const rollingMax =
    monthlyPcts.length > 0 ? Math.max(...monthlyPcts) : null;
  const rollingMedian = (() => {
    if (monthlyPcts.length === 0) return null;
    const s = [...monthlyPcts].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  })();

  // ── Cash flows from transaction summary ──────────────────
  const invested = txnSummary?.invested ?? null;
  const realized = txnSummary?.realized ?? null;
  const unrealized = txnSummary?.unrealized ?? null;

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
          <p className="section-label mb-3">§ 04 — Performance &amp; Attribution</p>
          <h1 className="font-serif text-6xl text-ink leading-tight mb-1">
            Two engines,
          </h1>
          <h1 className="font-serif text-6xl text-ink italic leading-tight mb-5">
            one quiet ledger.
          </h1>
          <p className="text-ink-3 text-sm leading-relaxed max-w-lg">
            {txnSummary && txnSummary.fills > 0
              ? `${txnSummary.fills} fills recorded. Total invested $${Math.round(txnSummary.invested).toLocaleString()} · realized P&L ${realized !== null ? `${sign(realized)}$${Math.round(Math.abs(realized)).toLocaleString()}` : "—"} · unrealized ${unrealized !== null ? `${sign(unrealized)}$${Math.round(Math.abs(unrealized)).toLocaleString()}` : "—"}.`
              : "Performance metrics derive from price snapshots collected while the app is running. Upload transactions to activate the full ledger."}
          </p>
        </div>
        <div className="col-span-2 flex items-center gap-6 pl-8 border-l border-parchment-border">
          {[
            { label: "MTD", value: fmtNull(mtd) },
            { label: "QTD", value: fmtNull(qtd) },
            { label: "YTD", value: fmtNull(ytd) },
            {
              label: "Since Incept.",
              value: totalReturnPct !== null ? fmtNull(totalReturnPct) : "—",
            },
          ].map((m) => (
            <div key={m.label}>
              <p className="section-label mb-1">{m.label}</p>
              <p
                className={`font-sans font-semibold text-2xl ${
                  m.value === "—"
                    ? "text-ink-3"
                    : m.value.startsWith("+")
                    ? "pos"
                    : "neg"
                }`}
              >
                {m.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* §01 Trailing Returns */}
      <SectionHeader
        num="01"
        title="Trailing Returns"
        right="From price snapshot history · Cost basis = inception"
      />
      <div className="border border-parchment-border rounded overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-parchment-dark border-b border-parchment-border">
              <th className="px-4 py-2 section-label text-left w-44"></th>
              {[
                "MTD",
                "QTD",
                "YTD",
                "ANN. (FULL)",
                "MAX DD",
                "BEST MO",
                "WORST MO",
                "TOTAL RETURN",
              ].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 section-label text-right whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Portfolio row — all real computed values */}
            <tr className="bg-parchment-dark font-semibold border-b border-parchment-border">
              <td className="px-4 py-2.5 text-xs font-semibold text-ink whitespace-nowrap">
                Portfolio
              </td>
              {[
                mtd,
                qtd,
                ytd,
                annRet,
                maxDD,
                rollingMax,
                rollingMin,
                totalReturnPct,
              ].map((v, i) => (
                <td
                  key={i}
                  className={`px-3 py-2.5 text-xs text-right font-semibold ${
                    v === null
                      ? "text-ink-4"
                      : v >= 0
                      ? "pos"
                      : "neg"
                  }`}
                >
                  {v !== null ? `${sign(v)}${fmt(Math.abs(v))}%` : "—"}
                </td>
              ))}
            </tr>

            {/* Benchmark rows — from real yfinance data */}
            {BENCH_REAL.map((row) => (
              <tr
                key={row.name}
                className="border-b border-parchment-border last:border-b-0 hover:bg-parchment/60"
              >
                <td className="px-4 py-2.5 text-xs text-ink-3 whitespace-nowrap">
                  {row.name}
                </td>
                {[row.mtd, row.qtd, row.ytd, null, null, row.best, row.worst, row.total].map(
                  (v, i) => (
                    <td
                      key={i}
                      className={`px-3 py-2.5 text-xs text-right ${
                        v === null
                          ? "text-ink-5"
                          : v >= 0
                          ? "text-positive"
                          : "neg"
                      }`}
                    >
                      {v !== null ? `${sign(v)}${fmt(Math.abs(v))}%` : "—"}
                    </td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2 bg-parchment-dark border-t border-parchment-border">
          <span className="text-2xs text-ink-4">
            Portfolio metrics computed from price snapshots · Benchmark rows from Yahoo Finance historical data (2-yr window)
          </span>
        </div>
      </div>

      {/* §02 Rolling + §03 Monthly */}
      <div className="grid grid-cols-5 gap-8 mt-0">
        <div className="col-span-3">
          <SectionHeader
            num="02"
            title="Rolling 12-Month Return — 36 Mo Window"
            right="Annualized"
          />
          <div
            className="bg-card-bg border border-parchment-border rounded"
            style={{ height: 220 }}
          >
            {perfData.length < 14 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-ink-4 text-sm">
                  Need 13+ months of price snapshot history.
                </p>
              </div>
            ) : (
              <Line data={rollingChartData} options={rollingOptions} />
            )}
          </div>
          <div className="flex items-center gap-4 mt-1">
            <span className="section-label">
              {rollingMin !== null
                ? `Min: ${sign(rollingMin)}${fmt(rollingMin)}%`
                : "Min: —"}{" "}
              ·{" "}
              {rollingMax !== null
                ? `Max: ${sign(rollingMax)}${fmt(rollingMax)}%`
                : "Max: —"}{" "}
              ·{" "}
              {rollingMedian !== null
                ? `Median: ${sign(rollingMedian)}${fmt(rollingMedian)}%`
                : "Median: —"}
            </span>
          </div>
        </div>

        <div className="col-span-2">
          <SectionHeader
            num="03"
            title="Monthly Returns"
            right={`${computedMonthly.length} months of history`}
          />
          {computedMonthly.length === 0 ? (
            <div className="flex items-center justify-center h-40 border border-parchment-border rounded">
              <p className="text-ink-4 text-sm">No monthly data yet.</p>
            </div>
          ) : (
            <div
              className="bg-card-bg border border-parchment-border rounded"
              style={{ height: 200 }}
            >
              <Bar data={monthlyBarData} options={monthlyBarOptions} />
            </div>
          )}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-2xs text-ink-4">
              Positive months:{" "}
              {computedMonthly.filter((m) => m.pct > 0).length} of{" "}
              {computedMonthly.length}
            </span>
            {rollingMedian !== null && (
              <span className="section-label">
                Median {sign(rollingMedian)}
                {fmt(rollingMedian)}%/mo
              </span>
            )}
          </div>
        </div>
      </div>

      {/* §04 P&L Summary */}
      <SectionHeader
        num="04"
        title="P&L Summary — From Transaction Ledger"
        right="FIFO · All-time"
      />
      <div className="grid grid-cols-4 gap-px bg-parchment-border border border-parchment-border rounded overflow-hidden">
        {[
          {
            label: "Total Invested",
            value:
              invested !== null
                ? `$${Math.round(invested).toLocaleString()}`
                : "—",
            sub: "Sum of all buy notionals + commissions",
          },
          {
            label: "Realized P&L",
            value:
              realized !== null
                ? `${sign(realized)}$${Math.round(Math.abs(realized)).toLocaleString()}`
                : "—",
            sub: "Closed lots · FIFO method",
            pos: realized !== null && realized >= 0,
            neg: realized !== null && realized < 0,
          },
          {
            label: "Unrealized P&L",
            value:
              unrealized !== null
                ? `${sign(unrealized)}$${Math.round(Math.abs(unrealized)).toLocaleString()}`
                : "—",
            sub: "Open positions at current prices",
            pos: unrealized !== null && unrealized >= 0,
            neg: unrealized !== null && unrealized < 0,
          },
          {
            label: "Total P&L",
            value: (() => {
              const r = realized ?? 0;
              const u = unrealized ?? 0;
              if (realized === null && unrealized === null) return "—";
              const total = r + u;
              return `${sign(total)}$${Math.round(Math.abs(total)).toLocaleString()}`;
            })(),
            sub: "Realized + unrealized combined",
            pos: (() => {
              const total = (realized ?? 0) + (unrealized ?? 0);
              return (realized !== null || unrealized !== null) && total >= 0;
            })(),
            neg: (() => {
              const total = (realized ?? 0) + (unrealized ?? 0);
              return (realized !== null || unrealized !== null) && total < 0;
            })(),
          },
        ].map((item) => (
          <div key={item.label} className="bg-card-bg p-5">
            <p className="section-label mb-1">{item.label}</p>
            <p
              className={`font-sans font-semibold text-2xl leading-tight ${
                item.pos ? "pos" : item.neg ? "neg" : "text-ink"
              }`}
            >
              {item.value}
            </p>
            <p className="text-ink-4 text-xs mt-1">{item.sub}</p>
          </div>
        ))}
      </div>

      {/* §05 Annual breakdown from transaction ledger */}
      <SectionHeader
        num="05"
        title="Portfolio Totals"
        right="Market value vs cost basis"
      />
      <div className="grid grid-cols-3 gap-px bg-parchment-border border border-parchment-border rounded overflow-hidden">
        {[
          {
            label: "Market Value",
            value:
              summary?.total_value != null
                ? `$${Math.round(summary.total_value).toLocaleString()}`
                : "—",
            sub: "At current prices",
          },
          {
            label: "Cost Basis",
            value:
              summary?.total_cost != null
                ? `$${Math.round(summary.total_cost).toLocaleString()}`
                : "—",
            sub: "Shares × avg cost",
          },
          {
            label: txnSummary?.last_fill ? "Last Fill" : "Active Positions",
            value: txnSummary?.last_fill
              ? new Date(txnSummary.last_fill).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : txnSummary?.active_positions != null
              ? String(txnSummary.active_positions)
              : "—",
            sub: txnSummary?.fills
              ? `${txnSummary.fills} total fills`
              : "From transaction ledger",
          },
        ].map((item) => (
          <div key={item.label} className="bg-card-bg p-5">
            <p className="section-label mb-1">{item.label}</p>
            <p className="font-sans font-semibold text-2xl text-ink leading-tight">
              {item.value}
            </p>
            <p className="text-ink-4 text-xs mt-1">{item.sub}</p>
          </div>
        ))}
      </div>

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
