import sys
from datetime import date, timedelta
sys.path.insert(0, r"C:\Users\Dhananjay\Downloads\Dhruv's Pvt docs\RiskMetrics")

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


# Not used as a context manager: app lifespan (real DATABASE_URL engine)
# never runs; all DB access goes through the overrides below.
client = TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _overrides():
    """Install this module's overrides per-test: dependency_overrides is
    app-global, so import-time assignment would leak into (and break) other
    test modules that override the same dependencies."""
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = _override_get_current_user
    yield
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


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


@pytest.fixture()
def portfolio():
    """Owner + portfolio with two holdings and NO price data."""
    global _current_user_id
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSession()
    owner = User(clerk_user_id="clerk_owner", email="owner@example.com")
    stranger = User(clerk_user_id="clerk_stranger", email="stranger@example.com")
    db.add_all([owner, stranger])
    db.flush()
    p = Portfolio(name="Metrics Probe", owner_id=owner.id)
    db.add(p)
    db.flush()
    db.add(Holding(portfolio_id=p.id, symbol="AAPL", quantity=10, avg_cost=150))
    db.add(Holding(portfolio_id=p.id, symbol="MSFT", quantity=5, avg_cost=300))
    db.commit()
    ids = {"owner": owner.id, "stranger": stranger.id, "portfolio": p.id}
    db.close()
    _current_user_id = ids["owner"]
    yield ids


def _as(user_key, ids):
    global _current_user_id
    _current_user_id = ids[user_key]


def _risk_body(pid):
    return {"portfolio_id": pid, "lookback_days": 60, "confidence_level": 0.95}


def test_body_portfolio_id_accepted_no_422(portfolio):
    """Regression: portfolio_id in JSON body must not 422 on ('query','portfolio_id')."""
    resp = client.post("/api/v1/ingest/risk-metrics", json=_risk_body(portfolio["portfolio"]))
    assert resp.status_code != 422, resp.text
    # No price data -> honest 400 naming the missing data, not a contract error.
    assert resp.status_code == 400, resp.text
    assert "price data" in resp.json()["detail"].lower()


def test_portfolio_value_body_id_accepted(portfolio):
    """Same 422 regression for POST /ingest/portfolio-value."""
    resp = client.post("/api/v1/ingest/portfolio-value",
                       json={"portfolio_id": portfolio["portfolio"], "as_of_date": None})
    assert resp.status_code != 422, resp.text
    assert resp.status_code == 200, resp.text


def test_risk_metrics_healthy(portfolio):
    """Healthy data -> 200 with matrix + contributions the UI consumes."""
    _seed_prices(["AAPL", "MSFT"])
    resp = client.post("/api/v1/ingest/risk-metrics", json=_risk_body(portfolio["portfolio"]))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    for key in ("portfolio_volatility", "var_95", "cvar_95", "max_drawdown",
                "holdings_var_contribution", "correlation_matrix"):
        assert key in body, f"missing {key}"
    assert set(body["correlation_matrix"].keys()) == {"AAPL", "MSFT"}
    assert body["correlation_matrix"]["AAPL"]["AAPL"] == pytest.approx(1.0)
    for row in body["holdings_var_contribution"]:
        # Fields the RiskMatrix mapping reads (marginal_var/var_contribution/weight).
        assert {"symbol", "weight", "var_contribution", "marginal_var"} <= set(row.keys())


def test_risk_metrics_unknown_portfolio_404(portfolio):
    resp = client.post("/api/v1/ingest/risk-metrics",
                       json=_risk_body(999999))
    assert resp.status_code == 404, resp.text


def test_risk_metrics_stranger_403(portfolio):
    _as("stranger", portfolio)
    resp = client.post("/api/v1/ingest/risk-metrics", json=_risk_body(portfolio["portfolio"]))
    assert resp.status_code == 403, resp.text
