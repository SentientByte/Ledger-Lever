import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import Header from "./components/Header";
import SummaryCards from "./components/SummaryCards";
import PerformanceChart from "./components/PerformanceChart";
import AllocationChart from "./components/AllocationChart";
import HoldingsTable from "./components/HoldingsTable";
import AddPositionModal from "./components/AddPositionModal";
import { getPositions, getSummary, manualRefresh } from "./api/portfolio";
import type { Position, PortfolioSummary } from "./types";

const REFRESH_INTERVAL = 60;

export default function App() {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [chartKey, setChartKey] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Position | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [s, p] = await Promise.all([getSummary(), getPositions()]);
      setSummary(s);
      setPositions(p);
      setChartKey((k) => k + 1);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  async function handleManualRefresh() {
    setRefreshing(true);
    try {
      await manualRefresh();
      await fetchAll(true);
      setCountdown(REFRESH_INTERVAL);
    } finally {
      setRefreshing(false);
    }
  }

  // Countdown ticker
  useEffect(() => {
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) return REFRESH_INTERVAL;
        return c - 1;
      });
    }, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // Auto-fetch every 60 s
  useEffect(() => {
    fetchAll();
    autoRefreshRef.current = setInterval(() => {
      fetchAll(true);
    }, REFRESH_INTERVAL * 1000);
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [fetchAll]);

  function openAdd() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(p: Position) {
    setEditing(p);
    setModalOpen(true);
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <Header
        lastUpdated={summary?.last_updated ?? null}
        refreshing={refreshing}
        onRefresh={handleManualRefresh}
        countdown={countdown}
      />

      <main className="flex-1 p-4 md:p-6 space-y-4 max-w-[1600px] w-full mx-auto">
        {/* Summary cards */}
        <SummaryCards summary={loading ? null : summary} />

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 min-h-[300px]">
            <PerformanceChart refreshKey={chartKey} />
          </div>
          <div className="min-h-[300px]">
            <AllocationChart positions={positions} />
          </div>
        </div>

        {/* Holdings table */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-300">Holdings</h2>
            <button
              onClick={openAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
            >
              <Plus size={14} />
              Add Position
            </button>
          </div>
          <HoldingsTable
            positions={positions}
            onEdit={openEdit}
            onDeleted={() => fetchAll(true)}
          />
        </div>
      </main>

      {modalOpen && (
        <AddPositionModal
          editing={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => fetchAll(true)}
        />
      )}
    </div>
  );
}
