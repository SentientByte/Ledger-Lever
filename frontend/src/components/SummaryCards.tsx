import { DollarSign, TrendingDown, TrendingUp, BarChart2 } from "lucide-react";
import type { PortfolioSummary } from "../types";

interface Props {
  summary: PortfolioSummary | null;
}

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function Card({
  label,
  value,
  sub,
  positive,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
  icon: React.ReactNode;
}) {
  const color =
    positive === undefined
      ? "text-slate-100"
      : positive
      ? "text-green-400"
      : "text-red-400";

  const subColor =
    positive === undefined ? "text-slate-400" : positive ? "text-green-500" : "text-red-500";

  return (
    <div className="bg-surface-card border border-surface-border rounded-xl p-5 flex items-start gap-4">
      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-slate-700 shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 mb-1 truncate">{label}</p>
        <p className={`text-2xl font-bold tracking-tight ${color}`}>{value}</p>
        {sub && <p className={`text-sm font-medium mt-0.5 ${subColor}`}>{sub}</p>}
      </div>
    </div>
  );
}

export default function SummaryCards({ summary }: Props) {
  if (!summary) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-surface-card border border-surface-border rounded-xl p-5 h-28 animate-pulse" />
        ))}
      </div>
    );
  }

  const dayPos = summary.day_gain >= 0;
  const totalPos = summary.total_gain >= 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card
        label="Portfolio Value"
        value={`$${fmt(summary.total_value)}`}
        sub={`Cost basis: $${fmt(summary.total_cost)}`}
        icon={<DollarSign size={18} className="text-blue-400" />}
      />
      <Card
        label="Day's Gain / Loss"
        value={`${dayPos ? "+" : ""}$${fmt(Math.abs(summary.day_gain))}`}
        sub={`${dayPos ? "+" : ""}${fmt(summary.day_gain_pct)}%`}
        positive={dayPos}
        icon={
          dayPos ? (
            <TrendingUp size={18} className="text-green-400" />
          ) : (
            <TrendingDown size={18} className="text-red-400" />
          )
        }
      />
      <Card
        label="Total Gain / Loss"
        value={`${totalPos ? "+" : ""}$${fmt(Math.abs(summary.total_gain))}`}
        sub={`${totalPos ? "+" : ""}${fmt(summary.total_gain_pct)}%`}
        positive={totalPos}
        icon={
          totalPos ? (
            <TrendingUp size={18} className="text-green-400" />
          ) : (
            <TrendingDown size={18} className="text-red-400" />
          )
        }
      />
      <Card
        label="Positions"
        value={String(summary.positions_count)}
        sub="active holdings"
        icon={<BarChart2 size={18} className="text-purple-400" />}
      />
    </div>
  );
}
