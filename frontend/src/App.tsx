import { useCallback, useEffect, useState } from "react";
import Header, { type Tab } from "./components/Header";
import OverviewPage from "./pages/OverviewPage";
import HoldingsPage from "./pages/HoldingsPage";
import RiskPage from "./pages/RiskPage";
import PerformancePage from "./pages/PerformancePage";
import PlaceholderPage from "./pages/PlaceholderPage";
import AddPositionModal from "./components/AddPositionModal";
import { getPositions, getSummary, getPerformance, manualRefresh } from "./api/portfolio";
import type { Position, PortfolioSummary, PerformancePoint } from "./types";

const REFRESH_INTERVAL = 60;

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("OVERVIEW");
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [perfData, setPerfData] = useState<PerformancePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Position | null>(null);

  const fetchAll = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [s, p, perf] = await Promise.all([
        getSummary(),
        getPositions(),
        getPerformance(365),
      ]);
      setSummary(s);
      setPositions(p);
      setPerfData(perf);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(() => fetchAll(true), REFRESH_INTERVAL * 1000);
    return () => clearInterval(id);
  }, [fetchAll]);

  async function handleManualRefresh() {
    setRefreshing(true);
    try {
      await manualRefresh();
      await fetchAll(true);
    } finally {
      setRefreshing(false);
    }
  }

  function openAdd() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(p: Position) {
    setEditing(p);
    setModalOpen(true);
  }

  const commonProps = {
    summary,
    positions,
    perfData,
    loading,
    refreshing,
    onRefresh: handleManualRefresh,
    onAddPosition: openAdd,
    onEditPosition: openEdit,
    onDeleted: () => fetchAll(true),
  };

  return (
    <div className="min-h-screen bg-parchment flex flex-col">
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        lastUpdated={summary?.last_updated ?? null}
      />

      <main className="flex-1">
        {activeTab === "OVERVIEW" && <OverviewPage {...commonProps} />}
        {activeTab === "HOLDINGS" && <HoldingsPage {...commonProps} />}
        {activeTab === "RISK" && <RiskPage {...commonProps} />}
        {activeTab === "PERFORMANCE" && <PerformancePage {...commonProps} />}
        {activeTab === "TRANSACTIONS" && <PlaceholderPage title="Transactions" subtitle="Transaction ledger coming soon." />}
        {activeTab === "INCOME" && <PlaceholderPage title="Income" subtitle="Distribution income register coming soon." />}
        {activeTab === "DOCUMENTS" && <PlaceholderPage title="Documents" subtitle="Document vault coming soon." />}
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
