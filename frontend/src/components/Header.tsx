import { RefreshCw, TrendingUp } from "lucide-react";

interface Props {
  lastUpdated: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  countdown: number;
}

export default function Header({ lastUpdated, refreshing, onRefresh, countdown }: Props) {
  const fmt = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-surface-border bg-surface-card">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600">
          <TrendingUp size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">Ledger Lever</h1>
          <p className="text-xs text-slate-500">Portfolio Dashboard</p>
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="text-right hidden sm:block">
          <p className="text-xs text-slate-500">Last updated</p>
          <p className="text-sm font-medium text-slate-300">{fmt(lastUpdated)}</p>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span>Refreshes in {countdown}s</span>
        </div>

        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-medium text-white transition-colors"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>
    </header>
  );
}
