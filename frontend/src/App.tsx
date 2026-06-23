import { useCallback, useEffect, useState } from "react";
import Header, { type Tab } from "./components/Header";
import OverviewPage from "./pages/OverviewPage";
import HoldingsPage from "./pages/HoldingsPage";
import RiskPage from "./pages/RiskPage";
import PerformancePage from "./pages/PerformancePage";
import DocumentsPage from "./pages/DocumentsPage";
import TransactionsPage from "./pages/TransactionsPage";
import AddPositionModal from "./components/AddPositionModal";
import {
  getPositions,
  getSummary,
  getPerformance,
  manualRefresh,
  getTransactionSummary,
  getDerivedPositions,
  getPriceBars,
  getMarketStatus,
} from "./api/portfolio";
import type {
  Position,
  PortfolioSummary,
  PerformancePoint,
  TransactionSummary,
  DerivedPosition,
  BarsResult,
  MarketStatus,
} from "./types";

// Live polling cadence: every 30s while the US market is open, every 5 min
// otherwise. The backend price scheduler uses the same cadence.
const REFRESH_OPEN_SECS = 30;
const REFRESH_CLOSED_SECS = 300;

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("OVERVIEW");
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [perfData, setPerfData] = useState<PerformancePoint[]>([]);
  const [txnSummary, setTxnSummary] = useState<TransactionSummary | null>(null);
  const [derivedPositions, setDerivedPositions] = useState<DerivedPosition[]>([]);
  const [barsData, setBarsData] = useState<BarsResult>({});
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Position | null>(null);

  const fetchAll = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [s, p, perf, ts, dp, mkt] = await Promise.all([
        getSummary(),
        getPositions(),
        getPerformance(730),
        getTransactionSummary().catch(() => null),
        getDerivedPositions().catch(() => [] as DerivedPosition[]),
        getMarketStatus().catch(() => null),
      ]);
      setSummary(s);
      setPositions(p);
      setPerfData(perf);
      setTxnSummary(ts);
      setDerivedPositions(dp);
      setMarketStatus(mkt);

      // Fetch historical bars for all held symbols + benchmark ETFs.
      // SPY = S&P 500, QQQ = Nasdaq-100; AGG/IEF feed the risk & attribution views.
      const benchmarks = ["SPY", "QQQ", "AGG", "IEF"];
      const heldSymbols = p.map((pos) => pos.symbol.toUpperCase());
      const allSymbols = [...new Set([...heldSymbols, ...benchmarks])];
      const bars = await getPriceBars(allSymbols, "2y").catch(() => ({} as BarsResult));
      setBarsData(bars);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Re-poll on a market-aware cadence: 30s while open, 5 min while closed.
  useEffect(() => {
    const secs = marketStatus?.is_open ? REFRESH_OPEN_SECS : REFRESH_CLOSED_SECS;
    const id = setInterval(() => fetchAll(true), secs * 1000);
    return () => clearInterval(id);
  }, [fetchAll, marketStatus?.is_open]);

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
    txnSummary,
    derivedPositions,
    barsData,
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
        marketStatus={marketStatus}
      />

      <main className="flex-1">
        {activeTab === "OVERVIEW" && <OverviewPage {...commonProps} />}
        {activeTab === "HOLDINGS" && <HoldingsPage {...commonProps} />}
        {activeTab === "RISK" && <RiskPage {...commonProps} />}
        {activeTab === "PERFORMANCE" && <PerformancePage {...commonProps} />}
        {activeTab === "TRANSACTIONS" && <TransactionsPage />}
        {activeTab === "DOCUMENTS" && <DocumentsPage />}
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
