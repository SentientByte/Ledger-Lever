from datetime import datetime
from typing import Optional
from pydantic import BaseModel, field_validator


class PositionCreate(BaseModel):
    symbol: str
    shares: float
    avg_cost: float

    @field_validator("symbol")
    @classmethod
    def upper_symbol(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("shares", "avg_cost")
    @classmethod
    def positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("Must be positive")
        return v


class PositionUpdate(BaseModel):
    shares: Optional[float] = None
    avg_cost: Optional[float] = None


class PositionResponse(BaseModel):
    id: int
    symbol: str
    name: Optional[str]
    shares: float
    avg_cost: float
    current_price: Optional[float]
    prev_close: Optional[float]
    market_value: Optional[float]
    cost_basis: float
    total_gain: Optional[float]
    total_gain_pct: Optional[float]
    day_gain: Optional[float]
    day_gain_pct: Optional[float]
    day_high: Optional[float]
    day_low: Optional[float]
    volume: Optional[float]
    created_at: datetime

    model_config = {"from_attributes": True}


class PortfolioSummary(BaseModel):
    total_value: float
    total_cost: float
    total_gain: float
    total_gain_pct: float
    day_gain: float
    day_gain_pct: float
    positions_count: int
    last_updated: Optional[datetime]


class PortfolioPerformancePoint(BaseModel):
    timestamp: str
    total_value: float
    total_cost: float
