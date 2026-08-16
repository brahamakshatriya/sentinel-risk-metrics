from datetime import date, datetime
from decimal import Decimal
from typing import Optional, List
from pydantic import BaseModel, Field, validator
from typing import Union


class PortfolioCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class PortfolioResponse(PortfolioCreate):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class HoldingCreate(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=20)
    quantity: Decimal = Field(..., gt=0)
    avg_cost: Decimal = Field(..., ge=0)

    @validator("symbol")
    def symbol_upper(cls, v):
        return v.upper()


class HoldingUpdate(BaseModel):
    quantity: Optional[Decimal] = Field(None, gt=0)
    avg_cost: Optional[Decimal] = Field(None, ge=0)


class HoldingResponse(HoldingCreate):
    id: int
    portfolio_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PortfolioWithHoldings(PortfolioResponse):
    holdings: List[HoldingResponse] = []


class PriceHistoryCreate(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=20)
    date: date
    open: Optional[Decimal] = Field(None, ge=0)
    high: Optional[Decimal] = Field(None, ge=0)
    low: Optional[Decimal] = Field(None, ge=0)
    close: Decimal = Field(..., gt=0)
    adjusted_close: Optional[Decimal] = Field(None, ge=0)
    volume: Optional[int] = Field(None, ge=0)

    @validator("symbol")
    def symbol_upper(cls, v):
        return v.upper()


class PriceHistoryResponse(PriceHistoryCreate):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class PriceIngestRequest(BaseModel):
    symbols: List[str] = Field(..., min_items=1, max_items=50)
    start_date: date
    end_date: date

    @validator("symbols", each_item=True)
    def symbol_upper(cls, v):
        return v.upper()

    @validator("end_date")
    def end_after_start(cls, v, values):
        if "start_date" in values and v < values["start_date"]:
            raise ValueError("end_date must be >= start_date")
        return v


class PriceIngestResponse(BaseModel):
    symbol: str
    records_ingested: int
    date_range: str
    skipped: bool = False
    error: Optional[str] = None


class PortfolioValueRequest(BaseModel):
    portfolio_id: int
    as_of_date: Optional[date] = None


class PortfolioValueResponse(BaseModel):
    portfolio_id: int
    portfolio_name: str
    as_of_date: date
    total_value: Decimal
    total_cost: Decimal
    total_pnl: Decimal
    total_pnl_pct: Decimal
    holdings: List[dict]


class RiskMetricsRequest(BaseModel):
    portfolio_id: int
    lookback_days: int = Field(default=252, ge=30, le=2520)
    confidence_level: float = Field(default=0.95, gt=0, lt=1)


class RiskMetricsResponse(BaseModel):
    portfolio_id: int
    portfolio_name: str
    as_of_date: date
    lookback_days: int
    confidence_level: float
    portfolio_volatility: Decimal
    var_95: Decimal
    cvar_95: Decimal
    max_drawdown: Decimal
    sharpe_ratio: Optional[Decimal] = None
    holdings_var_contribution: List[dict] = []


class MonteCarloRequest(BaseModel):
    portfolio_id: int
    lookback_days: int = Field(default=252, ge=30, le=2520)
    num_simulations: int = Field(default=5000, ge=100, le=20000)
    horizon_days: int = Field(default=252, ge=1, le=1260)
    confidence_level: float = Field(default=0.95, gt=0, lt=1)


class MonteCarloResponse(BaseModel):
    portfolio_id: int
    portfolio_name: str
    as_of_date: date
    lookback_days: int
    num_simulations: int
    horizon_days: int
    confidence_level: float
    current_value: Decimal
    var: Decimal
    cvar: Decimal
    var_pct: Decimal
    cvar_pct: Decimal
    mean_final_value: Decimal
    median_final_value: Decimal
    percentiles: dict
    return_percentiles: dict
    prob_loss: Decimal
    prob_gain: Decimal
    simulated_paths_sample: List[List[float]]


class HealthResponse(BaseModel):
    status: str
    database: str
    version: str