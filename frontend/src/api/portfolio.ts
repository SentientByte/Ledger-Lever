import axios from "axios";
import type {
  PerformancePoint,
  Position,
  PortfolioSummary,
  PositionCreate,
  PositionUpdate,
  PriceHistoryPoint,
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
