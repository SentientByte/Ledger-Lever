import axios from "axios";
import type {
  DerivedPosition,
  PerformancePoint,
  Position,
  PortfolioSummary,
  PositionCreate,
  PositionUpdate,
  PriceHistoryPoint,
  TransactionPage,
  TransactionSummary,
  TransactionUploadResult,
  YearActivity,
} from "../types";

const api = axios.create({ baseURL: "/api" });

export const getSummary = () =>
  api.get<PortfolioSummary>("/portfolio/summary").then((r) => r.data);

export const getPositions = () =>
  api.get<Position[]>("/positions").then((r) => r.data);

export const addPosition = (body: PositionCreate) =>
  api.post<Position>("/positions", body).then((r) => r.data);

export const updatePosition = (id: number, body: PositionUpdate) =>
  api.put<Position>(`/positions/${id}`, body).then((r) => r.data);

export const deletePosition = (id: number) =>
  api.delete(`/positions/${id}`).then((r) => r.data);

export const getPerformance = (days = 30) =>
  api.get<PerformancePoint[]>(`/portfolio/performance?days=${days}`).then((r) => r.data);

export const getPriceHistory = (symbol: string, period = "3mo") =>
  api.get<PriceHistoryPoint[]>(`/prices/${symbol}/history?period=${period}`).then((r) => r.data);

export const validateSymbol = (symbol: string) =>
  api.get(`/validate/${symbol}`).then((r) => r.data);

export const manualRefresh = () =>
  api.post("/portfolio/refresh").then((r) => r.data);

export const getTransactions = (params: {
  symbol?: string;
  side?: string;
  page?: number;
  page_size?: number;
}) =>
  api
    .get<TransactionPage>("/transactions", { params })
    .then((r) => r.data);

export const getTransactionSymbols = () =>
  api.get<string[]>("/transactions/symbols").then((r) => r.data);

export const getDerivedPositions = () =>
  api.get<DerivedPosition[]>("/transactions/positions").then((r) => r.data);

export const getTransactionSummary = () =>
  api.get<TransactionSummary>("/transactions/summary").then((r) => r.data);

export const getYearActivity = () =>
  api.get<YearActivity[]>("/transactions/activity").then((r) => r.data);

export const uploadTransactions = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api
    .post<TransactionUploadResult>("/transactions/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
    })
    .then((r) => r.data);
};

export const resetTransactions = () =>
  api.post<TransactionUploadResult>("/transactions/reset").then((r) => r.data);

export const clearTransactions = () =>
  api.delete("/transactions").then((r) => r.data);
