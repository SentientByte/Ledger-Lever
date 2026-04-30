import { useEffect, useState } from "react";
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
import { getPerformance } from "../api/portfolio";
import type { PerformancePoint } from "../types";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

const PERIODS = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
];

interface Props {
  refreshKey: number;
}

export default function PerformanceChart({ refreshKey }: Props) {
  const [data, setData] = useState<PerformancePoint[]>([]);
  const [period, setPeriod] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getPerformance(period)
      .then(setData)
      .finally(() => setLoading(false));
  }, [period, refreshKey]);

  const labels = data.map((d) =>
    new Date(d.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })
  );

  const isUp = data.length < 2 || data[data.length - 1].total_value >= data[0].total_value;
  const lineColor = isUp ? "#22c55e" : "#ef4444";

  const chartData = {
    labels,
    datasets: [
      {
        label: "Portfolio Value",
        data: data.map((d) => d.total_value),
        borderColor: lineColor,
        backgroundColor: isUp ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2,
      },
      {
        label: "Cost Basis",
        data: data.map((d) => d.total_cost),
        borderColor: "#475569",
        backgroundColor: "transparent",
        fill: false,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 1.5,
        borderDash: [4, 4],
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: {
        labels: { color: "#94a3b8", font: { size: 12 } },
      },
      tooltip: {
        backgroundColor: "#1e293b",
        borderColor: "#334155",
        borderWidth: 1,
        titleColor: "#f1f5f9",
        bodyColor: "#94a3b8",
        callbacks: {
          label: (ctx: { dataset: { label?: string }; parsed: { y: number | null } }) =>
            ctx.parsed.y == null ? "" : ` ${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
        },
      },
    },
    scales: {
      x: {
        ticks: { color: "#64748b", maxTicksLimit: 8 },
        grid: { color: "#1e293b" },
      },
      y: {
        ticks: {
          color: "#64748b",
          callback: (v: string | number) =>
            `$${Number(v).toLocaleString("en-US", { notation: "compact" })}`,
        },
        grid: { color: "#1e293b" },
      },
    },
  };

  return (
    <div className="bg-surface-card border border-surface-border rounded-xl p-5 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-300">Portfolio Performance</h2>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              onClick={() => setPeriod(p.days)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                period === p.days
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative flex-1 min-h-[220px]">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-slate-500 text-sm">Loading chart…</div>
          </div>
        ) : data.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-slate-500 text-sm">No performance data yet. Prices refresh every 60 s.</p>
          </div>
        ) : (
          <Line data={chartData} options={options} />
        )}
      </div>
    </div>
  );
}
