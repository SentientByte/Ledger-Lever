import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { Doughnut } from "react-chartjs-2";
import type { Position } from "../types";

ChartJS.register(ArcElement, Tooltip, Legend);

const PALETTE = [
  "#3b82f6", "#22c55e", "#a855f7", "#f59e0b", "#ef4444",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#8b5cf6",
];

interface Props {
  positions: Position[];
}

export default function AllocationChart({ positions }: Props) {
  const withValue = positions.filter((p) => p.market_value && p.market_value > 0);
  const total = withValue.reduce((s, p) => s + (p.market_value ?? 0), 0);

  if (withValue.length === 0) {
    return (
      <div className="bg-surface-card border border-surface-border rounded-xl p-5 flex flex-col">
        <h2 className="text-sm font-semibold text-slate-300 mb-4">Allocation</h2>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-slate-500 text-sm">No positions yet</p>
        </div>
      </div>
    );
  }

  const chartData = {
    labels: withValue.map((p) => p.symbol),
    datasets: [
      {
        data: withValue.map((p) => p.market_value ?? 0),
        backgroundColor: withValue.map((_, i) => PALETTE[i % PALETTE.length]),
        borderColor: "#1e293b",
        borderWidth: 2,
        hoverOffset: 6,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "68%",
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#1e293b",
        borderColor: "#334155",
        borderWidth: 1,
        titleColor: "#f1f5f9",
        bodyColor: "#94a3b8",
        callbacks: {
          label: (ctx: { label: string; parsed: number }) => {
            const pct = ((ctx.parsed / total) * 100).toFixed(1);
            const val = ctx.parsed.toLocaleString("en-US", { minimumFractionDigits: 2 });
            return ` $${val}  (${pct}%)`;
          },
        },
      },
    },
  };

  return (
    <div className="bg-surface-card border border-surface-border rounded-xl p-5 flex flex-col">
      <h2 className="text-sm font-semibold text-slate-300 mb-4">Allocation</h2>

      <div className="relative flex-1 min-h-[180px]">
        <Doughnut data={chartData} options={options} />
      </div>

      <ul className="mt-4 space-y-1.5">
        {withValue.map((p, i) => {
          const pct = (((p.market_value ?? 0) / total) * 100).toFixed(1);
          return (
            <li key={p.id} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                />
                <span className="text-slate-300 font-medium">{p.symbol}</span>
              </span>
              <span className="text-slate-400">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
