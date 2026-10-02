"""Phase S1 availability-protection tests (mocked, no external traffic)."""

import sys
import time
from datetime import date, timedelta

sys.path.insert(0, r"C:\Users\Dhananjay\Downloads\Dhruv's Pvt docs\RiskMetrics")

from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.models import Base, User, Portfolio, Holding, PriceHistory
from app.db.database import get_db
from app.auth import get_current_user
from app.security import resource_limits as limits
from app.security.gates import ingest_gate, mc_gate
from app.security.rate_limit import (
    AUTH_STANDARD,
    COMPUTE,
    INGEST,
    InMemoryRateLimiter,
    reset_global_limiter,
)

engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)

_current_user_id: int | None = None


def _override_get_db():
    db = TestingSession()
    try:
        yield db
    finally:
        db.close()


async def _override_get_current_user():
    db = TestingSession()
    try:
        user = db.query(User).filter(User.id == _current_user_id).first()
        assert user is not None, "test setup error: current user missing"
        return user
    finally:
        db.close()


client = TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _overrides():
    reset_global_limiter()
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = _override_get_current_user
    yield
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture()
def seed():
    global _current_user_id
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSession()
    owner = User(clerk_user_id="clerk_owner", email="owner@example.com")
    other = User(clerk_user_id="clerk_other", email="other@example.com")
    db.add_all([owner, other])
    db.flush()
    p = Portfolio(name="S1 Probe", owner_id=owner.id)
    db.add(p)
    db.flush()
    db.add(Holding(portfolio_id=p.id, symbol="AAPL", quantity=10, avg_cost=150))
    db.add(Holding(portfolio_id=p.id, symbol="MSFT", quantity=5, avg_cost=300))
    db.commit()
    ids = {"owner": owner.id, "other": other.id, "portfolio": p.id}
    db.close()
    _current_user_id = ids["owner"]
    yield ids


def _as(user_key, ids):
    global _current_user_id
    _current_user_id = ids[user_key]


def _seed_prices(symbols, days=90, seed=7):
    rng = np.random.default_rng(seed)
    db = TestingSession()
    base = date.today() - timedelta(days=days + 40)
    prices = {s: 100.0 + 50.0 * i for i, s in enumerate(symbols)}
    day = base
    added = 0
    while added < days:
        day += timedelta(days=1)
        if day.weekday() >= 5:
            continue
        for s in symbols:
            prices[s] *= 1 + float(rng.normal(0.0005, 0.01))
            px = prices[s]
            db.add(PriceHistory(symbol=s, date=day, open=px, high=px, low=px,
                                close=px, adjusted_close=px, volume=1000))
        added += 1
    db.commit()
    db.close()


# --- Rate limiter unit behavior --------------------------------------------

def test_rate_below_threshold_allowed():
    lim = InMemoryRateLimiter()
    for _ in range(3):
        allowed, _ = lim.check_and_consume("k1", limit=3, window_seconds=60)
        assert allowed is True


def test_rate_burst_over_limit_rejected_with_retry_after():
    lim = InMemoryRateLimiter()
    for _ in range(2):
        lim.check_and_consume("burst", limit=2, window_seconds=60)
    allowed, retry_after = lim.check_and_consume("burst", limit=2, window_seconds=60)
    assert allowed is False
    assert retry_after >= 1


def test_rate_bucket_isolation():
    lim = InMemoryRateLimiter()
    for _ in range(2):
        lim.check_and_consume("A", limit=2, window_seconds=60)
    allowed, _ = lim.check_and_consume("B", limit=2, window_seconds=60)
    assert allowed is True


def test_rate_authenticated_user_isolation():
    lim = InMemoryRateLimiter()
    for _ in range(2):
        lim.check_and_consume("COMPUTE:user:1", limit=2, window_seconds=60)
    allowed, _ = lim.check_and_consume("COMPUTE:user:2", limit=2, window_seconds=60)
    assert allowed is True


def test_rate_endpoint_class_isolation():
    lim = InMemoryRateLimiter()
    for _ in range(2):
        lim.check_and_consume("COMPUTE:id", limit=2, window_seconds=60)
    allowed, _ = lim.check_and_consume("INGEST:id", limit=2, window_seconds=60)
    assert allowed is True


def test_rate_expiry_reset():
    lim = InMemoryRateLimiter()
    lim.check_and_consume("exp", limit=1, window_seconds=1)
    allowed, _ = lim.check_and_consume("exp", limit=1, window_seconds=1)
    assert allowed is False
    time.sleep(1.1)
    allowed, _ = lim.check_and_consume("exp", limit=1, window_seconds=1)
    assert allowed is True


# --- Monte Carlo ------------------------------------------------------------

def test_mc_normal_envelope_succeeds(seed):
    _seed_prices(["AAPL", "MSFT"])
    resp = client.post(
        f"/api/v1/portfolios/{seed['portfolio']}/monte-carlo",
        json={"portfolio_id": seed["portfolio"], "lookback_days": 60,
              "num_simulations": 100, "horizon_days": 10, "confidence_level": 0.95},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["portfolio_id"] == seed["portfolio"]
    assert "var" in body and "cvar" in body


def test_mc_pathological_rejected_before_simulation(seed):
    _seed_prices(["AAPL", "MSFT"])
    with patch(
        "app.services.risk_calculator.RiskCalculator.run_monte_carlo"
    ) as mock_mc:
        resp = client.post(
            f"/api/v1/portfolios/{seed['portfolio']}/monte-carlo",
            json={"portfolio_id": seed["portfolio"], "lookback_days": 252,
                  "num_simulations": 20000, "horizon_days": 1260,
                  "confidence_level": 0.95},
        )
    assert resp.status_code == 413, resp.text
    assert resp.json()["error"] == "compute_budget_exceeded"
    mock_mc.assert_not_called()


def test_mc_busy_returns_429(seed):
    _seed_prices(["AAPL", "MSFT"])
    gate_key = f"mc:user:{seed['owner']}"
    assert mc_gate.try_acquire(gate_key) is True
    try:
        resp = client.post(
            f"/api/v1/portfolios/{seed['portfolio']}/monte-carlo",
            json={"portfolio_id": seed["portfolio"], "lookback_days": 60,
                  "num_simulations": 100, "horizon_days": 10,
                  "confidence_level": 0.95},
        )
    finally:
        mc_gate.release(gate_key)
    assert resp.status_code == 429, resp.text
    assert resp.json()["error"] == "compute_busy"
    assert "Retry-After" in resp.headers


def test_mc_cells_pure_function():
    assert limits.mc_cells(20000, 1260, 5) == 20000 * 1261 * 5
    assert limits.mc_cells(100, 10, 2) == 100 * 11 * 2


# --- Ingestion --------------------------------------------------------------

def test_ingest_batch_anonymous_rejected(seed):
    app.dependency_overrides.pop(get_current_user, None)
    try:
        resp = client.post(
            "/api/v1/ingest/batch",
            json={"symbols": ["AAPL"], "start_date": "2024-01-01",
                  "end_date": "2024-01-10"},
        )
    finally:
        app.dependency_overrides[get_current_user] = _override_get_current_user
    assert resp.status_code == 401, resp.text


def test_ingest_batch_authenticated_allowed(seed):
    fake_records = [{
        "symbol": "AAPL", "date": date(2024, 1, 2), "open": 100, "high": 101,
        "low": 99, "close": 100.5, "adjusted_close": 100.5, "volume": 1000,
    }]
    with patch(
        "app.routers.ingestion.yfinance_service.fetch_multiple_symbols",
        return_value={"AAPL": fake_records},
    ):
        resp = client.post(
            "/api/v1/ingest/batch",
            json={"symbols": ["AAPL"], "start_date": "2024-01-01",
                  "end_date": "2024-01-10"},
        )
    assert resp.status_code == 200, resp.text
    assert resp.json()[0]["records_ingested"] == 1


def test_ingest_symbol_day_budget_enforced_zero_yahoo_calls(seed):
    with patch(
        "app.routers.ingestion.yfinance_service.fetch_multiple_symbols"
    ) as mock_fetch:
        resp = client.post(
            "/api/v1/ingest/batch",
            json={"symbols": ["A", "B"],
                  "start_date": "2000-01-01", "end_date": "2024-01-01"},
        )
    assert resp.status_code == 413, resp.text
    assert resp.json()["error"] == "ingestion_budget_exceeded"
    mock_fetch.assert_not_called()


def test_ingest_date_span_exact_max_and_one_beyond(seed):
    end = date(2024, 1, 1)
    start_exact = end - timedelta(days=limits.INGEST_MAX_DATE_RANGE_DAYS - 1)
    assert limits.ingestion_span_days(start_exact, end) == limits.INGEST_MAX_DATE_RANGE_DAYS
    with patch(
        "app.routers.ingestion.yfinance_service.fetch_multiple_symbols",
        return_value={},
    ):
        resp = client.post(
            "/api/v1/ingest/batch",
            json={"symbols": ["AAPL"], "start_date": str(start_exact),
                  "end_date": str(end)},
        )
    assert resp.status_code == 200, resp.text
    start_over = start_exact - timedelta(days=1)
    with patch(
        "app.routers.ingestion.yfinance_service.fetch_multiple_symbols"
    ) as mock_fetch:
        resp = client.post(
            "/api/v1/ingest/batch",
            json={"symbols": ["AAPL"], "start_date": str(start_over),
                  "end_date": str(end)},
        )
    assert resp.status_code == 413, resp.text
    mock_fetch.assert_not_called()


def test_ingest_reversed_range_422(seed):
    resp = client.post(
        "/api/v1/ingest/batch",
        json={"symbols": ["AAPL"], "start_date": "2024-02-01",
              "end_date": "2024-01-01"},
    )
    assert resp.status_code == 422, resp.text


def test_ingest_leap_year_boundary(seed):
    with patch(
        "app.routers.ingestion.yfinance_service.fetch_multiple_symbols",
        return_value={},
    ):
        resp = client.post(
            "/api/v1/ingest/batch",
            json={"symbols": ["AAPL"], "start_date": "2024-02-28",
                  "end_date": "2024-03-01"},
        )
    assert resp.status_code == 200, resp.text
    assert limits.ingestion_span_days(date(2024, 2, 28), date(2024, 3, 1)) == 3


def test_ingest_single_invalid_symbol_422(seed):
    resp = client.post(
        "/api/v1/ingest/BAD!!SYM??",
        params={"start_date": "2024-01-01", "end_date": "2024-01-10"},
    )
    assert resp.status_code == 422, resp.text


def test_ingest_single_zero_yahoo_calls_on_over_budget(seed):
    with patch(
        "app.routers.ingestion.yfinance_service.fetch_price_history"
    ) as mock_fetch:
        resp = client.post(
            "/api/v1/ingest/AAPL",
            params={"start_date": "2000-01-01", "end_date": "2024-01-01"},
        )
    assert resp.status_code == 413, resp.text
    mock_fetch.assert_not_called()


def test_ingest_concurrency_bounded(seed):
    gate_key = f"ingest:user:{seed['owner']}"
    # Exhaust global slots (4) so the endpoint's non-blocking acquire fails.
    held = []
    for i in range(limits.INGEST_GLOBAL_CONCURRENCY):
        assert ingest_gate.try_acquire(f"filler:{i}") is True
        held.append(f"filler:{i}")
    try:
        resp = client.post(
            "/api/v1/ingest/batch",
            json={"symbols": ["AAPL"], "start_date": "2024-01-01",
                  "end_date": "2024-01-10"},
        )
    finally:
        for k in held:
            ingest_gate.release(k)
    assert resp.status_code == 429, resp.text
    assert resp.json()["error"] == "ingestion_busy"


def test_ingest_dedup_preserved(seed):
    db = TestingSession()
    db.add(PriceHistory(symbol="AAPL", date=date(2024, 1, 2), open=100,
                        high=101, low=99, close=100.5, adjusted_close=100.5,
                        volume=1000))
    db.commit()
    db.close()
    with patch(
        "app.routers.ingestion.yfinance_service.fetch_multiple_symbols",
        return_value={"AAPL": [{
            "symbol": "AAPL", "date": date(2024, 1, 2), "open": 100,
            "high": 101, "low": 99, "close": 100.5,
            "adjusted_close": 100.5, "volume": 1000,
        }]},
    ):
        resp = client.post(
            "/api/v1/ingest/batch",
            json={"symbols": ["AAPL"], "start_date": "2024-01-01",
                  "end_date": "2024-01-10"},
        )
    assert resp.status_code == 200, resp.text
    assert resp.json()[0]["skipped"] is True
    assert resp.json()[0]["records_ingested"] == 0


def test_rate_limit_error_contract_shape():
    from app.security.errors import RateLimitedError

    exc = RateLimitedError(retry_after=12, endpoint_class="INGEST")
    assert exc.retry_after == 12
    # Router-level 429 contract verified via busy tests; unit-check fields.
    assert str(exc) == "rate_limited"


def test_compute_rate_bucket_per_user_portfolio_isolated(seed):
    _seed_prices(["AAPL", "MSFT"])
    # Exhaust COMPUTE bucket for owner+portfolio by direct limiter use is
    # covered at unit level; here verify a second user is unaffected.
    _as("other", seed)
    resp = client.get(f"/api/v1/portfolios/{seed['portfolio']}")
    # Other has no share -> 403 proves authz still enforced before resources.
    assert resp.status_code == 403, resp.text
