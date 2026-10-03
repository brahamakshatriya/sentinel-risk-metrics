"""Phase S4 — Adversarial Security Verification & Production Readiness Gate.

Deterministic, mocked, non-destructive. No live Yahoo/FRED/Clerk/Render/
Neon traffic, no real DoS/load, no production migration execution.
Verifies S1-S3 enforce their contracts under boundary/concurrency/
malformed-input/regression pressure.
"""

import base64
import json
import sys
import time
from datetime import date, timedelta, datetime, timezone

sys.path.insert(0, r"C:\Users\Dhananjay\Downloads\Dhruv's Pvt docs\RiskMetrics")

from unittest.mock import MagicMock, patch

import pytest
import requests
from fastapi.testclient import TestClient
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool, QueuePool
from sqlalchemy.exc import TimeoutError as SATimeoutError
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt

import app.main as mainmod
from app.main import app
from app.models import Base, User, Portfolio, Holding, PortfolioShare, PermissionLevel
from app.db.database import get_db
from app.db import database as dbmod
from app.auth import get_current_user
import app.auth as authmod
from app.security import resource_limits as limits
from app.security.events import reset_abuse_tracker
from app.security.quotas import current_usage
from app.security.rate_limit import (
    AUTH_STANDARD, COMPUTE, INGEST, ANON, AUTH_READ, AUTH_MUTATION,
    InMemoryRateLimiter, compute_key, user_key, anon_key,
    reset_global_limiter,
)
from app.security.resource_limits import RateClassConfig
import app.services.riskfree_service as fredmod

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
    reset_abuse_tracker()
    fredmod.clear_cache()
    authmod.clear_jwks_cache()
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
    stranger = User(clerk_user_id="clerk_stranger", email="stranger@example.com")
    db.add_all([owner, other, stranger])
    db.flush()
    p = Portfolio(name="S4 Probe", owner_id=owner.id)
    db.add(p)
    db.flush()
    db.add(Holding(portfolio_id=p.id, symbol="AAPL", quantity=10, avg_cost=150))
    db.add(Holding(portfolio_id=p.id, symbol="MSFT", quantity=5, avg_cost=300))
    db.commit()
    ids = {"owner": owner.id, "other": other.id,
           "stranger": stranger.id, "portfolio": p.id}
    db.close()
    _current_user_id = ids["owner"]
    yield ids


def _as(who, ids):
    global _current_user_id
    _current_user_id = ids[who]


def _mc_result(pid, sims=100, horizon=10):
    return {
        "portfolio_id": pid, "portfolio_name": "S4 Probe",
        "as_of_date": date(2024, 1, 10), "lookback_days": 60,
        "num_simulations": sims, "horizon_days": horizon,
        "confidence_level": 0.95, "current_value": 1000.0,
        "var": 50.0, "cvar": 70.0, "var_pct": 0.05, "cvar_pct": 0.07,
        "mean_final_value": 1010.0, "median_final_value": 1005.0,
        "percentiles": {"5": 900.0}, "return_percentiles": {"5": -0.1},
        "prob_loss": 0.4, "prob_gain": 0.6, "simulated_paths_sample": [[1.0, 2.0]],
    }


def _b64url_uint(n: int) -> str:
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _keypair(kid):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    nums = key.public_key().public_numbers()
    jwk = {"kty": "RSA", "use": "sig", "kid": kid, "alg": "RS256",
           "n": _b64url_uint(nums.n), "e": _b64url_uint(nums.e)}
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()).decode("ascii")
    return pem, jwk


ISSUER = "https://test-clerk.accounts.dev"


def _resp_jwks(jwks):
    r = MagicMock()
    r.json.return_value = jwks
    r.raise_for_status.return_value = None
    return r


def _token(pem, kid, claims):
    now = int(time.time())
    base = {"iss": ISSUER, "iat": now, "exp": now + 600}
    base.update(claims)
    return jwt.encode(base, pem, algorithm="RS256", headers={"kid": kid})


LEAK_TOKENS = ["Traceback", "sqlalchemy", "SELECT", "/app/", ".py",
               "secret-conn", "stack", "File \"" ]


def _assert_no_leak(text):
    low = text.lower()
    assert "traceback" not in low
    assert "sqlalchemy" not in low
    assert "secret-conn" not in low
    assert "stack trace" not in low


# ============================================================================
# 3. RATE-LIMIT ADVERSARIAL
# ============================================================================

def test_s4_anon_repeated_boundary_and_expiry():
    lim = InMemoryRateLimiter()
    for _ in range(3):
        ok, _ = lim.check_and_consume("anonK", limit=3, window_seconds=60)
        assert ok is True
    ok, retry = lim.check_and_consume("anonK", limit=3, window_seconds=60)
    assert ok is False and retry >= 1  # boundary: 3 allowed, 4th rejected


def test_s4_anon_window_expiry_resets():
    lim = InMemoryRateLimiter()
    assert lim.check_and_consume("expK", limit=1, window_seconds=1)[0] is True
    assert lim.check_and_consume("expK", limit=1, window_seconds=1)[0] is False
    time.sleep(1.1)
    assert lim.check_and_consume("expK", limit=1, window_seconds=1)[0] is True


def test_s4_anon_independent_ip_buckets():
    lim = InMemoryRateLimiter()
    for _ in range(2):
        lim.check_and_consume("ANON:ip:1.1.1.1", limit=2, window_seconds=60)
    ok, _ = lim.check_and_consume("ANON:ip:2.2.2.2", limit=2, window_seconds=60)
    assert ok is True


def test_s4_anon_independent_endpoint_classes():
    lim = InMemoryRateLimiter()
    for _ in range(2):
        lim.check_and_consume("ANON:x", limit=2, window_seconds=60)
    ok, _ = lim.check_and_consume("COMPUTE:x", limit=2, window_seconds=60)
    assert ok is True


def test_s4_anon_http_429_contract(seed, monkeypatch):
    monkeypatch.setitem(limits.RATE_CLASSES, "ANON", RateClassConfig(2, 60))
    from app.security.rate_limit import client_ip  # noqa
    r1 = client.get("/api/v1/ingest/price-history/AAPL")
    assert r1.status_code == 200
    r2 = client.get("/api/v1/ingest/price-history/AAPL")
    assert r2.status_code == 200
    r3 = client.get("/api/v1/ingest/price-history/AAPL")
    assert r3.status_code == 429, r3.text
    body = r3.json()
    assert body["error"] == "rate_limited"
    assert isinstance(body["retry_after"], int) and body["retry_after"] >= 1
    assert body["retry_after"] < 10_000  # finite, sensible
    assert "Retry-After" in r3.headers
    assert int(r3.headers["Retry-After"]) == body["retry_after"]


def test_s4_auth_user_buckets_isolated():
    lim = InMemoryRateLimiter()
    for _ in range(2):
        lim.check_and_consume("AUTH_STANDARD:user:1", limit=2, window_seconds=60)
    ok, _ = lim.check_and_consume("AUTH_STANDARD:user:2", limit=2, window_seconds=60)
    assert ok is True  # A cannot consume B's bucket


def test_s4_auth_classes_isolated():
    lim = InMemoryRateLimiter()
    for _ in range(2):
        lim.check_and_consume("AUTH_READ:user:9", limit=2, window_seconds=60)
    ok, _ = lim.check_and_consume("AUTH_MUTATION:user:9", limit=2, window_seconds=60)
    assert ok is True  # READ does not consume MUTATION


def test_s4_compute_ingest_do_not_consume_standard(seed, monkeypatch):
    monkeypatch.setitem(limits.RATE_CLASSES, "AUTH_READ", RateClassConfig(1, 60))
    monkeypatch.setitem(limits.RATE_CLASSES, "COMPUTE", RateClassConfig(20, 60))
    monkeypatch.setitem(limits.RATE_CLASSES, "INGEST", RateClassConfig(30, 60))
    _as("owner", seed)
    # Exhaust READ bucket once (list_portfolios uses AUTH_READ)
    assert client.get("/api/v1/portfolios/").status_code == 200
    assert client.get("/api/v1/portfolios/").status_code == 429
    # Compute class unaffected (different bucket) — use mocked MC success
    with patch("app.services.risk_calculator.RiskCalculator.run_monte_carlo",
               return_value=_mc_result(seed["portfolio"])):
        r = client.post(f"/api/v1/portfolios/{seed['portfolio']}/monte-carlo",
                        json={"portfolio_id": seed["portfolio"], "lookback_days": 60,
                              "num_simulations": 100, "horizon_days": 10,
                              "confidence_level": 0.95})
    assert r.status_code == 200, r.text


def test_s4_compute_bucket_per_portfolio_isolated():
    k1 = compute_key(1, 100)
    k2 = compute_key(1, 200)
    assert k1 != k2
    assert compute_key(1, 100) != compute_key(2, 100)


def test_s4_429_retry_after_sane(seed, monkeypatch):
    monkeypatch.setitem(limits.RATE_CLASSES, "AUTH_READ", RateClassConfig(1, 60))
    _as("owner", seed)
    assert client.get("/api/v1/portfolios/").status_code == 200
    r = client.get("/api/v1/portfolios/")
    assert r.status_code == 429
    ra = r.json()["retry_after"]
    assert isinstance(ra, int) and 1 <= ra <= 3600
    assert r.headers["Retry-After"] == str(ra)


# ============================================================================
# 4. AUTHORIZATION-BEFORE-RATE-LIMIT
# ============================================================================

def test_s4_stranger_mc_forbidden_never_429(seed, monkeypatch):
    monkeypatch.setitem(limits.RATE_CLASSES, "COMPUTE", RateClassConfig(1, 60))
    _as("stranger", seed)
    r1 = client.post(f"/api/v1/portfolios/{seed['portfolio']}/monte-carlo",
                     json={"portfolio_id": seed["portfolio"], "lookback_days": 60,
                           "num_simulations": 100, "horizon_days": 10,
                           "confidence_level": 0.95})
    assert r1.status_code == 403, r1.text
    r2 = client.post(f"/api/v1/portfolios/{seed['portfolio']}/monte-carlo",
                     json={"portfolio_id": seed["portfolio"], "lookback_days": 60,
                           "num_simulations": 100, "horizon_days": 10,
                           "confidence_level": 0.95})
    assert r2.status_code == 403, r2.text  # never 429 — authz first


def test_s4_stranger_does_not_consume_owner_compute(seed):
    _as("stranger", seed)
    for _ in range(3):
        assert client.post(f"/api/v1/portfolios/{seed['portfolio']}/monte-carlo",
                           json={"portfolio_id": seed["portfolio"], "lookback_days": 60,
                                 "num_simulations": 100, "horizon_days": 10,
                                 "confidence_level": 0.95}).status_code == 403
    _as("owner", seed)
    with patch("app.services.risk_calculator.RiskCalculator.run_monte_carlo",
               return_value=_mc_result(seed["portfolio"])):
        r = client.post(f"/api/v1/portfolios/{seed['portfolio']}/monte-carlo",
                        json={"portfolio_id": seed["portfolio"], "lookback_days": 60,
                              "num_simulations": 100, "horizon_days": 10,
                              "confidence_level": 0.95})
    assert r.status_code == 200  # owner bucket untouched by stranger


def test_s4_body_portfolio_value_authz_first_no_bucket_burn(seed, monkeypatch):
    """Body-based endpoints must also enforce authz before rate limit."""
    monkeypatch.setitem(limits.RATE_CLASSES, "AUTH_STANDARD", RateClassConfig(2, 60))
    _as("stranger", seed)
    for _ in range(3):
        r = client.post("/api/v1/ingest/portfolio-value",
                        json={"portfolio_id": seed["portfolio"]})
        assert r.status_code == 403, r.text  # must stay 403, never 429
    # Stranger's own legitimate read still has budget (nothing consumed by 403s)
    _as("other", seed)
    db = TestingSession()
    p2 = Portfolio(name="Other P", owner_id=seed["other"])
    db.add(p2); db.commit(); other_pid = p2.id; db.close()
    _as("other", seed)
    r = client.post("/api/v1/ingest/portfolio-value",
                    json={"portfolio_id": other_pid})
    assert r.status_code == 200, r.text


def test_s4_risk_metrics_authz_first(seed, monkeypatch):
    monkeypatch.setitem(limits.RATE_CLASSES, "AUTH_STANDARD", RateClassConfig(2, 60))
    _as("stranger", seed)
    for _ in range(3):
        r = client.post("/api/v1/ingest/risk-metrics",
                        json={"portfolio_id": seed["portfolio"], "lookback_days": 60,
                              "confidence_level": 0.95})
        # 403 authz denial (or 400 only if authz passed — must not be 429)
        assert r.status_code == 403, r.text


# ============================================================================
# 5. MONTE CARLO RESOURCE EXHAUSTION
# ============================================================================

def test_s4_mc_far_under_budget_accepted(seed):
    _as("owner", seed)
    with patch("app.services.risk_calculator.RiskCalculator.run_monte_carlo",
               return_value=_mc_result(seed["portfolio"])) as m:
        r = client.post(f"/api/v1/portfolios/{seed['portfolio']}/monte-carlo",
                        json={"portfolio_id": seed["portfolio"], "lookback_days": 60,
                              "num_simulations": 100, "horizon_days": 10,
                              "confidence_level": 0.95})
    assert r.status_code == 200, r.text
    assert m.call_count == 1


def test_s4_mc_exact_boundary_accepted(seed, monkeypatch):
    monkeypatch.setattr(limits, "MC_CELLS_BUDGET", 1000)
    # cells = sims*(horizon+1)*assets ; seed has 2 assets
    # 100 sims * (4+1) * 2 = 1000 == budget
    _as("owner", seed)
    with patch("app.services.risk_calculator.RiskCalculator.run_monte_carlo",
               return_value=_mc_result(seed["portfolio"], 100, 4)):
        r = client.post(f"/api/v1/portfolios/{seed['portfolio']}/monte-carlo",
                        json={"portfolio_id": seed["portfolio"], "lookback_days": 60,
                              "num_simulations": 100, "horizon_days": 4,
                              "confidence_level": 0.95})
    assert r.status_code == 200, r.text


def test_s4_mc_one_over_boundary_413_no_alloc(seed, monkeypatch):
    monkeypatch.setattr(limits, "MC_CELLS_BUDGET", 1000)
    # 100*(5+1)*2 = 1200 > 1000
    _as("owner", seed)
    with patch("app.services.risk_calculator.RiskCalculator.run_monte_carlo") as m:
        r = client.post(f"/api/v1/portfolios/{seed['portfolio']}/monte-carlo",
                        json={"portfolio_id": seed["portfolio"], "lookback_days": 60,
                              "num_simulations": 100, "horizon_days": 5,
                              "confidence_level": 0.95})
    assert r.status_code == 413, r.text
    assert r.json()["error"] == "compute_budget_exceeded"
    m.assert_not_called()  # rejected BEFORE allocation/execution


def test_s4_mc_real_budget_boundary_shape(seed):
    # cells == 8M inclusive-accepted at pure-function level (no heavy run)
    assert limits.mc_cells(20000, 199, 2) == 8_000_000
    assert limits.mc_cells(20000, 199, 2) <= limits.MC_CELLS_BUDGET
    assert limits.mc_cells(20000, 200, 2) > limits.MC_CELLS_BUDGET


# ============================================================================
# 6. MONTE CARLO CONCURRENCY
# ============================================================================

def test_s4_mc_busy_when_user_slot_occupied(seed):
    from app.security.gates import mc_gate
    _as("owner", seed)
    key = f"mc:user:{seed['owner']}"
    assert mc_gate.try_acquire(key) is True
    try:
        with patch("app.services.risk_calculator.RiskCalculator.run_monte_carlo") as m:
            r = client.post(f"/api/v1/portfolios/{seed['portfolio']}/monte-carlo",
                            json={"portfolio_id": seed["portfolio"], "lookback_days": 60,
                                  "num_simulations": 100, "horizon_days": 10,
                                  "confidence_level": 0.95})
    finally:
        mc_gate.release(key)
    assert r.status_code == 429 and r.json()["error"] == "compute_busy"
    assert "Retry-After" in r.headers
    m.assert_not_called()


def test_s4_mc_userA_does_not_block_userB(seed):
    from app.security.gates import mc_gate
    assert mc_gate.try_acquire(f"mc:user:{seed['owner']}") is True
    try:
        # other user gate key is independent; global has 2 slots so B fits
        assert mc_gate.try_acquire(f"mc:user:{seed['other']}") is True
        mc_gate.release(f"mc:user:{seed['other']}")
    finally:
        mc_gate.release(f"mc:user:{seed['owner']}")


def test_s4_mc_gate_released_after_success(seed):
    from app.security.gates import mc_gate
    _as("owner", seed)
    with patch("app.services.risk_calculator.RiskCalculator.run_monte_carlo",
               return_value=_mc_result(seed["portfolio"])):
        assert client.post(f"/api/v1/portfolios/{seed['portfolio']}/monte-carlo",
                           json={"portfolio_id": seed["portfolio"], "lookback_days": 60,
                                 "num_simulations": 100, "horizon_days": 10,
                                 "confidence_level": 0.95}).status_code == 200
    assert mc_gate.try_acquire(f"mc:user:{seed['owner']}") is True
    mc_gate.release(f"mc:user:{seed['owner']}")


def test_s4_mc_gate_released_after_exception(seed):
    from app.security.gates import mc_gate
    _as("owner", seed)
    with patch("app.services.risk_calculator.RiskCalculator.run_monte_carlo",
               side_effect=RuntimeError("boom")):
        r = client.post(f"/api/v1/portfolios/{seed['portfolio']}/monte-carlo",
                        json={"portfolio_id": seed["portfolio"], "lookback_days": 60,
                              "num_simulations": 100, "horizon_days": 10,
                              "confidence_level": 0.95})
    assert r.status_code in (400, 500)
    assert mc_gate.try_acquire(f"mc:user:{seed['owner']}") is True
    mc_gate.release(f"mc:user:{seed['owner']}")


def test_s4_mc_same_user_concurrent_bounded():
    from app.security.gates import BoundedGate
    g = BoundedGate(global_slots=4, per_key_slots=1)
    assert g.try_acquire("u1") is True
    assert g.try_acquire("u1") is False  # same-user second slot blocked
    g.release("u1")
    assert g.try_acquire("u1") is True
    g.release("u1")


# ============================================================================
# 7. INGESTION ADVERSARIAL
# ============================================================================

def test_s4_ingest_span_exact_max_ok(seed):
    from app.routers import ingestion as ing
    end = date(2024, 1, 1)
    start = end - timedelta(days=limits.INGEST_MAX_DATE_RANGE_DAYS - 1)
    with patch.object(ing.yfinance_service, "fetch_multiple_symbols", return_value={}):
        r = client.post("/api/v1/ingest/batch",
                        json={"symbols": ["AAPL"], "start_date": str(start),
                              "end_date": str(end)})
    assert r.status_code == 200, r.text


def test_s4_ingest_span_one_over_rejected_no_yahoo(seed):
    from app.routers import ingestion as ing
    end = date(2024, 1, 1)
    start = end - timedelta(days=limits.INGEST_MAX_DATE_RANGE_DAYS)
    with patch.object(ing.yfinance_service, "fetch_multiple_symbols") as m:
        r = client.post("/api/v1/ingest/batch",
                        json={"symbols": ["AAPL"], "start_date": str(start),
                              "end_date": str(end)})
    assert r.status_code == 413 and r.json()["error"] == "ingestion_budget_exceeded"
    m.assert_not_called()


def test_s4_ingest_reversed_dates_422(seed):
    r = client.post("/api/v1/ingest/batch",
                    json={"symbols": ["AAPL"], "start_date": "2024-02-01",
                          "end_date": "2024-01-01"})
    assert r.status_code == 422


def test_s4_ingest_symbol_count_matrix(seed):
    from app.routers import ingestion as ing
    r = client.post("/api/v1/ingest/batch",
                    json={"symbols": [], "start_date": "2024-01-01",
                          "end_date": "2024-01-10"})
    assert r.status_code == 422  # zero
    with patch.object(ing.yfinance_service, "fetch_multiple_symbols", return_value={}):
        r = client.post("/api/v1/ingest/batch",
                        json={"symbols": ["AAPL"], "start_date": "2024-01-01",
                              "end_date": "2024-01-10"})
    assert r.status_code == 200  # one
    syms50 = [f"S{i:02d}" for i in range(50)]
    with patch.object(ing.yfinance_service, "fetch_multiple_symbols", return_value={}):
        r = client.post("/api/v1/ingest/batch",
                        json={"symbols": syms50, "start_date": "2024-01-01",
                              "end_date": "2024-01-10"})
    assert r.status_code == 200  # maximum
    syms51 = [f"S{i:02d}" for i in range(51)]
    r = client.post("/api/v1/ingest/batch",
                    json={"symbols": syms51, "start_date": "2024-01-01",
                          "end_date": "2024-01-10"})
    assert r.status_code == 422  # one over max_items


def test_s4_ingest_symbol_days_boundaries(seed, monkeypatch):
    from app.routers import ingestion as ing
    monkeypatch.setattr(limits, "INGEST_MAX_SYMBOL_DAYS", 100)
    monkeypatch.setattr(limits, "INGEST_MAX_DATE_RANGE_DAYS", 10_000)
    with patch.object(ing.yfinance_service, "fetch_multiple_symbols", return_value={}):
        r = client.post("/api/v1/ingest/batch",
                        json={"symbols": ["A", "B"], "start_date": "2024-01-01",
                              "end_date": "2024-01-10"})  # 2x10=20 under
    assert r.status_code == 200
    with patch.object(ing.yfinance_service, "fetch_multiple_symbols", return_value={}):
        r = client.post("/api/v1/ingest/batch",
                        json={"symbols": ["A", "B", "C", "D", "E"],
                              "start_date": "2024-01-01",
                              "end_date": "2024-01-20"})  # 5x20=100 exact
    assert r.status_code == 200, r.text
    with patch.object(ing.yfinance_service, "fetch_multiple_symbols") as m:
        r = client.post("/api/v1/ingest/batch",
                        json={"symbols": ["A", "B", "C", "D", "E"],
                              "start_date": "2024-01-01",
                              "end_date": "2024-01-21"})  # 5x21=105 over
    assert r.status_code == 413
    m.assert_not_called()


def test_s4_ingest_symbol_validation_contract(seed):
    from app.routers import ingestion as ing
    # lowercase accepted + normalized (existing contract — not rejected)
    with patch.object(ing.yfinance_service, "fetch_multiple_symbols", return_value={}):
        assert client.post("/api/v1/ingest/batch",
                           json={"symbols": ["aapl"], "start_date": "2024-01-01",
                                 "end_date": "2024-01-10"}).status_code == 200
    # whitespace-padded accepted (strip+upper per _validate_symbol_shape)
    with patch.object(ing.yfinance_service, "fetch_multiple_symbols", return_value={}):
        assert client.post("/api/v1/ingest/batch",
                           json={"symbols": ["  msft "], "start_date": "2024-01-01",
                                 "end_date": "2024-01-10"}).status_code == 200
    for bad in ["BAD!!", "A" * 21, "A B", "x;y"]:
        r = client.post(f"/api/v1/ingest/{bad}",
                        params={"start_date": "2024-01-01", "end_date": "2024-01-10"})
        assert r.status_code == 422, (bad, r.text)
    # empty symbol via batch shape check (path "" has no route -> 404 by design)
    r = client.post("/api/v1/ingest/batch",
                    json={"symbols": [""], "start_date": "2024-01-01",
                          "end_date": "2024-01-10"})
    assert r.status_code == 422, r.text
    # duplicates: existing contract allows (no invented dedup rule)
    with patch.object(ing.yfinance_service, "fetch_multiple_symbols", return_value={}):
        r = client.post("/api/v1/ingest/batch",
                        json={"symbols": ["AAPL", "AAPL"], "start_date": "2024-01-01",
                              "end_date": "2024-01-10"})
    assert r.status_code == 200, r.text


# ============================================================================
# 8. PERSISTENT QUOTA ADVERSARIAL
# ============================================================================

def test_s4_quota_under_accepted(seed):
    from app.routers import ingestion as ing
    with patch.object(ing.yfinance_service, "fetch_multiple_symbols",
                      return_value={"AAPL": [{"symbol": "AAPL", "date": date(2024, 1, 2),
                                             "open": 1, "high": 1, "low": 1, "close": 1,
                                             "adjusted_close": 1, "volume": 1}]}):
        r = client.post("/api/v1/ingest/batch",
                        json={"symbols": ["AAPL"], "start_date": "2024-01-01",
                              "end_date": "2024-01-10"})
    assert r.status_code == 200


def test_s4_quota_exact_accepted_one_over_rejected(seed, monkeypatch):
    from app.routers import ingestion as ing
    monkeypatch.setattr(limits, "DAILY_INGEST_SYMBOL_DAYS", 20)
    with patch.object(ing.yfinance_service, "fetch_multiple_symbols",
                      return_value={"AAPL": [{"symbol": "AAPL", "date": date(2024, 1, 2),
                                             "open": 1, "high": 1, "low": 1, "close": 1,
                                             "adjusted_close": 1, "volume": 1}]}):
        r = client.post("/api/v1/ingest/batch",
                        json={"symbols": ["AAPL", "MSFT"], "start_date": "2024-01-01",
                              "end_date": "2024-01-10"})  # 20 == quota
    assert r.status_code == 200, r.text
    with patch.object(ing.yfinance_service, "fetch_multiple_symbols") as m:
        r = client.post("/api/v1/ingest/batch",
                        json={"symbols": ["AAPL"], "start_date": "2024-01-01",
                              "end_date": "2024-01-02"})  # 2 over
    assert r.status_code == 429
    assert r.json()["error"] == "business_quota_exceeded"
    assert "Retry-After" in r.headers
    assert int(r.headers["Retry-After"]) >= 1
    m.assert_not_called()


def test_s4_quota_utc_boundary_isolated(seed):
    from app.security import quotas as qmod
    from app.models import IngestionQuota
    db = TestingSession()
    yesterday = qmod.utc_today() - timedelta(days=1)
    db.add(IngestionQuota(user_id=seed["owner"], day=yesterday, symbol_days=99999))
    db.commit(); db.close()
    assert current_usage(TestingSession(), seed["owner"]) == 0  # yesterday ignored
    TestingSession().close()


def test_s4_quota_concurrent_bounded_no_corruption(seed):
    import tempfile, threading
    from app.security.quotas import record_ingest_usage
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False); tmp.close()
    fe = create_engine(f"sqlite:///{tmp.name}", connect_args={"check_same_thread": False},
                       poolclass=QueuePool)
    try:
        Base.metadata.create_all(bind=fe)
        FS = sessionmaker(bind=fe)
        s = FS(); u = User(clerk_user_id="clerk_qc", email="qc@example.com")
        s.add(u); s.commit(); uid = u.id; s.close()
        errs = []

        def w():
            try:
                q = FS()
                try:
                    record_ingest_usage(q, uid, 100)
                finally:
                    q.close()
            except Exception as e:
                errs.append(e)

        ts = [threading.Thread(target=w) for _ in range(5)]
        [t.start() for t in ts]; [t.join() for t in ts]
        assert errs == []
        q = FS()
        try:
            assert current_usage(q, uid) == 500
            assert current_usage(q, uid) >= 0
        finally:
            q.close()
    finally:
        import os
        fe.dispose(); os.unlink(tmp.name)


# ============================================================================
# 9. DATABASE INTEGRITY
# ============================================================================

def test_s4_holding_uniqueness_no_duplicates(seed):
    _as("owner", seed)
    r = client.post(f"/api/v1/portfolios/{seed['portfolio']}/holdings",
                    json={"symbol": "AAPL", "quantity": "5", "avg_cost": "150.00"})
    assert r.status_code == 201
    db = TestingSession()
    try:
        n = db.query(Holding).filter(Holding.portfolio_id == seed["portfolio"],
                                     Holding.symbol == "AAPL").count()
        assert n == 1  # merged, not duplicated
    finally:
        db.close()


def test_s4_share_uniqueness_preserved(seed):
    _as("owner", seed)
    assert client.post(f"/api/v1/portfolios/{seed['portfolio']}/share",
                       json={"email": "other@example.com",
                             "permission": "view"}).status_code == 201
    assert client.post(f"/api/v1/portfolios/{seed['portfolio']}/share",
                       json={"email": "other@example.com",
                             "permission": "edit"}).status_code == 201
    db = TestingSession()
    try:
        n = db.query(PortfolioShare).filter(
            PortfolioShare.portfolio_id == seed["portfolio"],
            PortfolioShare.shared_with_user_id == seed["other"]).count()
        assert n == 1
        assert db.query(PortfolioShare).filter(
            PortfolioShare.portfolio_id == seed["portfolio"],
            PortfolioShare.shared_with_user_id == seed["other"]).first().permission == PermissionLevel.edit
    finally:
        db.close()


def test_s4_ingest_dedup_no_duplicate_rows(seed):
    from app.routers.ingestion import _insert_new_records
    from app.models import PriceHistory
    db = TestingSession()
    db.add(PriceHistory(symbol="AAPL", date=date(2024, 1, 2), open=1, high=1,
                        low=1, close=1, adjusted_close=1, volume=1))
    db.commit()
    recs = [{"symbol": "AAPL", "date": date(2024, 1, 2), "open": 1, "high": 1,
             "low": 1, "close": 1, "adjusted_close": 1, "volume": 1},
            {"symbol": "AAPL", "date": date(2024, 1, 3), "open": 1, "high": 1,
             "low": 1, "close": 1, "adjusted_close": 1, "volume": 1}]
    assert _insert_new_records(db, recs, known_dates=set()) == 1
    assert db.query(PriceHistory).filter(PriceHistory.symbol == "AAPL").count() == 2
    db.close()


def test_s4_quota_one_row_per_user_day(seed):
    from app.models import IngestionQuota
    from app.security.quotas import record_ingest_usage
    db = TestingSession()
    try:
        record_ingest_usage(db, seed["owner"], 10)
        record_ingest_usage(db, seed["owner"], 5)
        rows = db.query(IngestionQuota).filter(
            IngestionQuota.user_id == seed["owner"]).all()
        assert len(rows) == 1
        assert rows[0].symbol_days == 15
    finally:
        db.close()


def test_s4_resource_caps_boundaries(seed, monkeypatch):
    monkeypatch.setattr(limits, "MAX_PORTFOLIOS_PER_USER", 2)
    # seed owns 1; create 1 more OK, next rejected
    assert client.post("/api/v1/portfolios/", json={"name": "P2"}).status_code == 201
    r = client.post("/api/v1/portfolios/", json={"name": "P3"})
    assert r.status_code == 413 and r.json()["error"] == "portfolio_limit_reached"
    monkeypatch.setattr(limits, "MAX_SHARES_PER_PORTFOLIO", 1)
    _as("owner", seed)
    assert client.post(f"/api/v1/portfolios/{seed['portfolio']}/share",
                       json={"email": "other@example.com",
                             "permission": "view"}).status_code == 201
    r = client.post(f"/api/v1/portfolios/{seed['portfolio']}/share",
                    json={"email": "stranger@example.com", "permission": "view"})
    assert r.status_code == 413 and r.json()["error"] == "share_limit_reached"


def test_s4_holdings_cap_boundary(seed, monkeypatch):
    from app.security import financial_bounds as fb
    monkeypatch.setattr(fb, "MAX_HOLDINGS_PER_PORTFOLIO", 3)
    _as("owner", seed)
    # seed has 2 (AAPL, MSFT); 3rd OK, 4th rejected
    assert client.post(f"/api/v1/portfolios/{seed['portfolio']}/holdings",
                       json={"symbol": "TSLA", "quantity": "1",
                             "avg_cost": "10"}).status_code == 201
    r = client.post(f"/api/v1/portfolios/{seed['portfolio']}/holdings",
                    json={"symbol": "NVDA", "quantity": "1", "avg_cost": "10"})
    assert r.status_code == 422


# ============================================================================
# 10. POOL EXHAUSTION
# ============================================================================

def test_s4_pool_config_values():
    opts = dbmod.pool_options("postgresql://u:p@localhost/db")
    assert opts == {"pool_size": 5, "max_overflow": 5, "pool_timeout": 10,
                    "pool_recycle": 300, "pool_pre_ping": True}
    assert dbmod.pool_options("sqlite:///./x.db") == {}
    eng = dbmod.build_engine("postgresql://u:p@localhost/db")
    assert isinstance(eng.pool, QueuePool)
    eng.dispose()


def test_s4_pool_exhaustion_sanitized_503(seed):
    def broken():
        raise SATimeoutError("QueuePool limit overflow secret-conn-xyz")
        yield
    app.dependency_overrides[get_db] = broken
    try:
        r = client.get("/api/v1/portfolios/")
    finally:
        app.dependency_overrides[get_db] = _override_get_db
    assert r.status_code == 503
    assert r.json()["error"] == "service_unavailable"
    _assert_no_leak(r.text)
    assert "Retry-After" in r.headers


# ============================================================================
# 11. BODY SIZE
# ============================================================================

def test_s4_body_below_limit_ok(seed):
    r = client.post("/api/v1/portfolios/", json={"name": "hello"})
    assert r.status_code == 201
    assert r.json()["name"] == "hello"  # byte-equivalent, unmutated


def test_s4_body_exact_and_one_over(seed):
    overhead = len(json.dumps({"name": ""}).encode())
    n_exact = limits.MAX_BODY_BYTES - overhead
    payload_exact = json.dumps({"name": "x" * n_exact}).encode()
    r = client.post("/api/v1/portfolios/", content=payload_exact,
                    headers={"Content-Type": "application/json"})
    assert r.status_code != 413  # size guard passes; validation decides (422 name-long)
    assert r.status_code == 422, r.text
    payload_over = json.dumps({"name": "x" * (n_exact + 1)}).encode()
    r = client.post("/api/v1/portfolios/", content=payload_over,
                    headers={"Content-Type": "application/json"})
    assert r.status_code == 413
    assert r.json()["error"] == "request_too_large"


def test_s4_body_chunked_paths():
    import asyncio
    from app.security.http import BodySizeLimitMiddleware
    captured = {}

    async def ok_app(scope, receive, send):
        body = b""
        while True:
            msg = await receive()
            body += msg.get("body", b"")
            if not msg.get("more_body"):
                break
        captured["body"] = body
        await send({"type": "http.response.start", "status": 200,
                    "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": b"{}"})

    def run_chunked(chunks):
        msgs = [{"type": "http.request", "body": c, "more_body": i < len(chunks) - 1}
                for i, c in enumerate(chunks)]
        it = iter(msgs)
        sent = []

        async def receive():
            try:
                return next(it)
            except StopIteration:
                return {"type": "http.request", "body": b"", "more_body": False}

        async def send(m):
            sent.append(m)

        scope = {"type": "http", "path": "/x", "headers": []}
        asyncio.run(BodySizeLimitMiddleware(ok_app, max_bytes=10)(scope, receive, send))
        return sent

    sent = run_chunked([b"12345"])
    assert sent[0]["status"] == 200 and captured["body"] == b"12345"
    sent = run_chunked([b"12345678901"])
    assert sent[0]["status"] == 413


def test_s4_body_oversize_never_reaches_logic(seed):
    with patch("app.routers.portfolios.Portfolio") as m:
        big = "x" * (limits.MAX_BODY_BYTES + 100)
        r = client.post("/api/v1/portfolios/", json={"name": big})
    assert r.status_code == 413
    m.assert_not_called()


# ============================================================================
# 12. UPSTREAM FAILURE
# ============================================================================

def test_s4_yahoo_transient_one_retry_then_success():
    import sys as _sys
    yfmod = _sys.modules["app.services.yfinance_service"]
    yfsingle = yfmod.yfinance_service
    import pandas as pd
    idx = pd.date_range("2024-01-02", periods=1, freq="D")
    frame = pd.DataFrame({"Open": [1.0], "High": [1.0], "Low": [1.0],
                          "Close": [1.0], "Adj Close": [1.0], "Volume": [1]}, index=idx)
    t = MagicMock()
    t.history.side_effect = [requests.exceptions.ConnectionError("down"), frame]
    with patch("yfinance.Ticker", return_value=t):
        recs = yfsingle.fetch_price_history(
            "AAPL", date(2024, 1, 1), date(2024, 1, 10))
    assert len(recs) == 1 and t.history.call_count == 2


def test_s4_yahoo_nontransient_no_retry():
    import sys as _sys
    yfmod = _sys.modules["app.services.yfinance_service"]
    yfsingle = yfmod.yfinance_service
    t = MagicMock()
    t.history.side_effect = ValueError("bad symbol")
    with patch("yfinance.Ticker", return_value=t):
        assert yfsingle.fetch_price_history(
            "AAPL", date(2024, 1, 1), date(2024, 1, 10)) == []
    assert t.history.call_count == 1


def test_s4_yahoo_empty_no_retry():
    import sys as _sys
    yfmod = _sys.modules["app.services.yfinance_service"]
    yfsingle = yfmod.yfinance_service
    import pandas as pd
    t = MagicMock()
    t.history.return_value = pd.DataFrame()
    with patch("yfinance.Ticker", return_value=t):
        assert yfsingle.fetch_price_history(
            "AAPL", date(2024, 1, 1), date(2024, 1, 10)) == []
    assert t.history.call_count == 1


def test_s4_yahoo_repeated_failure_sanitized():
    import sys as _sys
    yfmod = _sys.modules["app.services.yfinance_service"]
    yfsingle = yfmod.yfinance_service
    t = MagicMock()
    t.history.side_effect = requests.exceptions.ConnectionError("cred-xyz")
    with patch("yfinance.Ticker", return_value=t):
        recs = yfsingle.fetch_price_history(
            "AAPL", date(2024, 1, 1), date(2024, 1, 10))
    assert recs == [] and t.history.call_count == 2  # bounded, sanitized []


def test_s4_fred_retry_and_cap():
    from app.security.upstream import cap_retries
    assert cap_retries(99) == 1 and cap_retries(0) == 0
    with patch("fredapi.Fred") as mf:
        mf.return_value.get_series.side_effect = requests.exceptions.ConnectionError()
        fredmod.FRED_API_KEY = "k"
        try:
            assert fredmod.get_risk_free_rate(None) == fredmod.DEFAULT_RATE
            assert mf.return_value.get_series.call_count == 2
        finally:
            fredmod.clear_cache()


def test_s4_fred_timeout_bounded(monkeypatch):
    import threading
    monkeypatch.setattr(fredmod, "_FRED_TIMEOUT", 0.2)
    fredmod.FRED_API_KEY = "k"
    fredmod.clear_cache()
    block = threading.Event()

    def hang(*a, **k):
        block.wait(10)
        import pandas as pd
        return pd.Series([5.0])

    try:
        with patch("fredapi.Fred") as mf:
            mf.return_value.get_series.side_effect = hang
            t0 = time.monotonic()
            assert fredmod.get_risk_free_rate(None) == fredmod.DEFAULT_RATE
            assert time.monotonic() - t0 < 5
    finally:
        block.set(); fredmod.clear_cache()


# ============================================================================
# 13. JWKS / AUTH FAILURE
# ============================================================================

def test_s4_jwks_cached_valid(monkeypatch):
    monkeypatch.setattr(authmod, "CLERK_JWKS_URL", "https://t/jwks")
    monkeypatch.setattr(authmod, "CLERK_ISSUER", ISSUER)
    pem, jwk = _keypair("k1")
    with patch.object(authmod.httpx, "get", return_value=_resp_jwks({"keys": [jwk]})):
        p = authmod.verify_clerk_token(_token(pem, "k1", {"sub": "u"}))
    assert p["sub"] == "u"


def test_s4_jwks_unknown_kid_refresh_then_ok(monkeypatch):
    monkeypatch.setattr(authmod, "CLERK_JWKS_URL", "https://t/jwks")
    monkeypatch.setattr(authmod, "CLERK_ISSUER", ISSUER)
    pem1, jwk1 = _keypair("k1"); pem2, jwk2 = _keypair("k2")
    with patch.object(authmod.httpx, "get", return_value=_resp_jwks({"keys": [jwk1]})):
        authmod.get_jwks()
    tok = _token(pem2, "k2", {"sub": "rot"})
    with patch.object(authmod.httpx, "get",
                      return_value=_resp_jwks({"keys": [jwk1, jwk2]})) as m:
        key = authmod.get_signing_key(tok)
        assert jwt.decode(tok, key, algorithms=["RS256"], issuer=ISSUER,
                          options={"verify_aud": False})["sub"] == "rot"
    assert m.call_count == 1


def test_s4_jwks_unknown_after_refresh_401(monkeypatch):
    monkeypatch.setattr(authmod, "CLERK_JWKS_URL", "https://t/jwks")
    monkeypatch.setattr(authmod, "CLERK_ISSUER", ISSUER)
    _, jwk1 = _keypair("k1"); pemX, _ = _keypair("kx")
    with patch.object(authmod.httpx, "get", return_value=_resp_jwks({"keys": [jwk1]})):
        authmod.get_jwks()
    tok = _token(pemX, "kx", {"sub": "intruder"})
    with patch.object(authmod.httpx, "get",
                      return_value=_resp_jwks({"keys": [jwk1]})):
        with pytest.raises(HTTPException) as e:
            authmod.get_signing_key(tok)
    assert e.value.status_code == 401


def test_s4_jwks_unavailable_503_or_401(monkeypatch):
    monkeypatch.setattr(authmod, "CLERK_JWKS_URL", "https://t/jwks")
    monkeypatch.setattr(authmod, "CLERK_ISSUER", ISSUER)
    _, jwk1 = _keypair("k1"); pemX, _ = _keypair("kx")
    with patch.object(authmod.httpx, "get", return_value=_resp_jwks({"keys": [jwk1]})):
        authmod.get_jwks()
    tok = _token(pemX, "kx", {"sub": "intruder"})
    with patch.object(authmod.httpx, "get", side_effect=Exception("down")):
        with pytest.raises(HTTPException) as e:
            authmod.get_signing_key(tok)
    assert e.value.status_code in (401, 503)


def test_s4_jwks_invalid_sig_wrong_issuer_wrong_alg(monkeypatch):
    monkeypatch.setattr(authmod, "CLERK_JWKS_URL", "https://t/jwks")
    monkeypatch.setattr(authmod, "CLERK_ISSUER", ISSUER)
    pem, jwk = _keypair("k1")
    with patch.object(authmod.httpx, "get", return_value=_resp_jwks({"keys": [jwk]})):
        good = _token(pem, "k1", {"sub": "u"})
        with pytest.raises(HTTPException) as e:
            authmod.verify_clerk_token(good[:-2] + "AA")
        assert e.value.status_code == 401
    with patch.object(authmod.httpx, "get", return_value=_resp_jwks({"keys": [jwk]})):
        evil = jwt.encode({"iss": "https://evil.example", "sub": "u",
                           "iat": int(time.time()),
                           "exp": int(time.time()) + 600},
                          pem, algorithm="RS256", headers={"kid": "k1"})
        with pytest.raises(HTTPException) as e:
            authmod.verify_clerk_token(evil)
        assert e.value.status_code == 401
    with patch.object(authmod.httpx, "get", return_value=_resp_jwks({"keys": [jwk]})):
        hs = jwt.encode({"iss": ISSUER, "sub": "u", "iat": int(time.time()),
                         "exp": int(time.time()) + 600},
                        "not-secret", algorithm="HS256", headers={"kid": "k1"})
        with pytest.raises(HTTPException) as e:
            authmod.verify_clerk_token(hs)
        assert e.value.status_code == 401
        none_tok = jwt.encode({"iss": ISSUER, "sub": "u"}, "x",
                              algorithm="HS256", headers={"kid": "k1"})
        with pytest.raises(HTTPException):
            authmod.verify_clerk_token(none_tok)


# ============================================================================
# 14. DISCLOSURE
# ============================================================================

def test_s4_disclosure_matrix(seed, monkeypatch):
    monkeypatch.setattr(mainmod, "ENV", "production")
    # health degraded redacted
    ctx = MagicMock(); ctx.__enter__.side_effect = Exception("host=db.internal /secret")
    with patch.object(mainmod, "get_db_session", return_value=ctx):
        r = client.get("/health")
    assert r.json()["database_error"] is None
    _assert_no_leak(r.text)
    # 500 sanitized
    def broken():
        raise RuntimeError("super secret-conn-xyz")
        yield
    app.dependency_overrides[get_db] = broken
    try:
        r = client.get("/api/v1/portfolios/")
    finally:
        app.dependency_overrides[get_db] = _override_get_db
    assert r.status_code == 500 and r.json()["error"] == "internal_server_error"
    _assert_no_leak(r.text)
    # 503 sanitized
    def broken2():
        raise SATimeoutError("secret-conn pool")
        yield
    app.dependency_overrides[get_db] = broken2
    try:
        r = client.get("/api/v1/portfolios/")
    finally:
        app.dependency_overrides[get_db] = _override_get_db
    assert r.status_code == 503
    _assert_no_leak(r.text)
    # 422/403/429/413 carry no internals
    _as("stranger", seed)
    for r in [client.get(f"/api/v1/portfolios/{seed['portfolio']}"),
              client.post("/api/v1/portfolios/", json={"name": ""}),
              client.post(f"/api/v1/portfolios/{seed['portfolio']}/holdings",
                          json={"symbol": "BAD!!", "quantity": "1",
                                "avg_cost": "1"})]:
        _assert_no_leak(r.text)
        assert r.status_code in (403, 422)


# ============================================================================
# 15. FINANCIAL BOUNDS
# ============================================================================

@pytest.mark.parametrize("qty,status", [
    ("10", 201), ("0.000001", 201), ("1000000000", 201),
    ("0", 422), ("-5", 422), ("1000000000.01", 422),
    ("nan", 422), ("NaN", 422), ("inf", 422), ("-inf", 422),
    ("Infinity", 422), ("abc", 422), ("", 422),
])
def test_s4_quantity_matrix(seed, qty, status):
    _as("owner", seed)
    r = client.post(f"/api/v1/portfolios/{seed['portfolio']}/holdings",
                    json={"symbol": "Q", "quantity": qty, "avg_cost": "10"})
    assert r.status_code == status, (qty, r.text)


@pytest.mark.parametrize("cost,status", [
    ("10", 201), ("0", 201), ("0.00", 201), ("10000000", 201),
    ("-0.01", 422), ("10000000.01", 422),
    ("nan", 422), ("inf", 422), ("-inf", 422), ("abc", 422),
])
def test_s4_avg_cost_matrix(seed, cost, status):
    _as("owner", seed)
    import uuid
    sym = "C" + uuid.uuid4().hex[:6].upper()
    r = client.post(f"/api/v1/portfolios/{seed['portfolio']}/holdings",
                    json={"symbol": sym, "quantity": "1", "avg_cost": cost})
    assert r.status_code == status, (cost, r.text)


def test_s4_no_silent_clamping(seed):
    _as("owner", seed)
    r = client.post(f"/api/v1/portfolios/{seed['portfolio']}/holdings",
                    json={"symbol": "CL", "quantity": "1000000001",
                          "avg_cost": "10"})
    assert r.status_code == 422  # rejected, not clamped to max


# ============================================================================
# 16. ERROR CONTRACT AUDIT (repository's actual names)
# ============================================================================

def test_s4_error_contract_matrix(seed, monkeypatch):
    _as("owner", seed)
    # 422 validation
    r = client.post("/api/v1/portfolios/", json={"name": ""})
    assert (r.status_code, r.json()["error"]) == (422, "validation_error")
    # 429 rate_limited
    monkeypatch.setitem(limits.RATE_CLASSES, "AUTH_READ", RateClassConfig(1, 60))
    assert client.get("/api/v1/portfolios/").status_code == 200
    r = client.get("/api/v1/portfolios/")
    assert r.status_code == 429 and r.json()["error"] == "rate_limited"
    assert "Retry-After" in r.headers
    reset_global_limiter()
    # 413 compute budget
    monkeypatch.setattr(limits, "MC_CELLS_BUDGET", 10)
    with patch("app.services.risk_calculator.RiskCalculator.run_monte_carlo") as m:
        r = client.post(f"/api/v1/portfolios/{seed['portfolio']}/monte-carlo",
                        json={"portfolio_id": seed["portfolio"], "lookback_days": 60,
                              "num_simulations": 100, "horizon_days": 10,
                              "confidence_level": 0.95})
    assert r.status_code == 413 and r.json()["error"] == "compute_budget_exceeded"
    m.assert_not_called()
    # 429 compute_busy
    from app.security.gates import mc_gate
    k = f"mc:user:{seed['owner']}"
    assert mc_gate.try_acquire(k) is True
    try:
        r = client.post(f"/api/v1/portfolios/{seed['portfolio']}/monte-carlo",
                        json={"portfolio_id": seed["portfolio"], "lookback_days": 60,
                              "num_simulations": 100, "horizon_days": 10,
                              "confidence_level": 0.95})
    finally:
        mc_gate.release(k)
    # budget still 10 so 413 takes precedence over busy here; restore then recheck busy
    monkeypatch.setattr(limits, "MC_CELLS_BUDGET", 8_000_000)
    assert mc_gate.try_acquire(k) is True
    try:
        r = client.post(f"/api/v1/portfolios/{seed['portfolio']}/monte-carlo",
                        json={"portfolio_id": seed["portfolio"], "lookback_days": 60,
                              "num_simulations": 100, "horizon_days": 10,
                              "confidence_level": 0.95})
    finally:
        mc_gate.release(k)
    assert r.status_code == 429 and r.json()["error"] == "compute_busy"
    # 429 business quota
    monkeypatch.setattr(limits, "DAILY_INGEST_SYMBOL_DAYS", 5)
    from app.routers import ingestion as ing
    with patch.object(ing.yfinance_service, "fetch_multiple_symbols") as m:
        r = client.post("/api/v1/ingest/batch",
                        json={"symbols": ["AAPL"], "start_date": "2024-01-01",
                              "end_date": "2024-01-10"})
    assert r.status_code == 429 and r.json()["error"] == "business_quota_exceeded"
    m.assert_not_called()
    # 401 auth failure
    app.dependency_overrides.pop(get_current_user, None)
    try:
        r = client.post("/api/v1/ingest/batch",
                        json={"symbols": ["AAPL"], "start_date": "2024-01-01",
                              "end_date": "2024-01-10"})
    finally:
        app.dependency_overrides[get_current_user] = _override_get_current_user
    assert r.status_code == 401
    # 403 authz denial
    _as("stranger", seed)
    r = client.get(f"/api/v1/portfolios/{seed['portfolio']}")
    assert r.status_code == 403


# ============================================================================
# 17. REGRESSION (security did not break business)
# ============================================================================

def test_s4_regression_portfolio_crud(seed):
    _as("owner", seed)
    r = client.post("/api/v1/portfolios/", json={"name": "Reg"})
    assert r.status_code == 201
    pid = r.json()["id"]
    assert client.get(f"/api/v1/portfolios/{pid}").status_code == 200
    assert client.get("/api/v1/portfolios/").status_code == 200


def test_s4_regression_holdings_shares(seed):
    _as("owner", seed)
    assert client.post(f"/api/v1/portfolios/{seed['portfolio']}/holdings",
                       json={"symbol": "TSLA", "quantity": "2",
                             "avg_cost": "200"}).status_code == 201
    assert client.get(f"/api/v1/portfolios/{seed['portfolio']}/holdings").status_code == 200
    assert client.post(f"/api/v1/portfolios/{seed['portfolio']}/share",
                       json={"email": "other@example.com",
                             "permission": "view"}).status_code == 201
    assert client.get(f"/api/v1/portfolios/{seed['portfolio']}/shares").status_code == 200


def test_s4_regression_risk_endpoints_mocked(seed):
    _as("owner", seed)
    with patch("app.services.risk_calculator.RiskCalculator.run_monte_carlo",
               return_value=_mc_result(seed["portfolio"])):
        assert client.post(f"/api/v1/portfolios/{seed['portfolio']}/monte-carlo",
                           json={"portfolio_id": seed["portfolio"],
                                 "lookback_days": 60, "num_simulations": 100,
                                 "horizon_days": 10,
                                 "confidence_level": 0.95}).status_code == 200
    with patch("app.services.risk_calculator.RiskCalculator.run_scenario_analysis",
               return_value={"portfolio_id": seed["portfolio"],
                             "portfolio_name": "S4 Probe",
                             "as_of_date": date(2024, 1, 10),
                             "market_drop_pct": -10.0, "vol_spike_pct": 20.0,
                             "current_value": 1000.0, "shocked_value": 900.0,
                             "value_change": -100.0, "value_change_pct": -10.0,
                             "original_var_95": 50.0, "shocked_var_95": 60.0,
                             "var_change_pct": 20.0, "original_volatility": 0.2,
                             "shocked_volatility": 0.24}):
        assert client.post(f"/api/v1/portfolios/{seed['portfolio']}/scenario",
                           json={"portfolio_id": seed["portfolio"],
                                 "market_drop_pct": -10, "vol_spike_pct": 20,
                                 "lookback_days": 60,
                                 "confidence_level": 0.95}).status_code == 200
    with patch("app.services.risk_calculator.RiskCalculator.calculate_risk_score",
               return_value={"portfolio_id": seed["portfolio"],
                             "portfolio_name": "S4 Probe",
                             "risk_score": 42, "risk_label": "Moderate",
                             "var_component": 0.5, "sharpe_component": 0.5,
                             "correlation_component": 0.5}):
        assert client.get(f"/api/v1/portfolios/{seed['portfolio']}/risk-score").status_code == 200
    assert client.post("/api/v1/ingest/portfolio-value",
                       json={"portfolio_id": seed["portfolio"]}).status_code == 200


def test_s4_regression_ingest_and_history(seed):
    from app.routers import ingestion as ing
    rec = {"symbol": "AAPL", "date": date(2024, 1, 2), "open": 1, "high": 1,
           "low": 1, "close": 1, "adjusted_close": 1, "volume": 1}
    with patch.object(ing.yfinance_service, "fetch_multiple_symbols",
                      return_value={"AAPL": [rec]}):
        assert client.post("/api/v1/ingest/batch",
                           json={"symbols": ["AAPL"],
                                 "start_date": "2024-01-01",
                                 "end_date": "2024-01-10"}).status_code == 200
    assert client.get("/api/v1/ingest/price-history/AAPL").status_code == 200
    # auth/authz preserved
    _as("stranger", seed)
    assert client.get(f"/api/v1/portfolios/{seed['portfolio']}").status_code == 403


# ============================================================================
# 18. MIGRATION SAFETY
# ============================================================================

def test_s4_migration_additive_and_reversible():
    import re
    p = (r"C:\Users\Dhananjay\Downloads\Dhruv's Pvt docs\RiskMetrics"
         r"\alembic\versions\c41f9d2a7e55_add_ingestion_quotas_table.py")
    src = open(p).read()
    assert re.search(r"^revision\s*=\s*['\"]c41f9d2a7e55['\"]", src, re.M)
    assert re.search(r"^down_revision\s*=\s*['\"]be8acd5f3e64['\"]", src, re.M)
    assert "create_table" in src and "ingestion_quotas" in src
    assert "uq_quota_user_day" in src
    assert "drop_table" in src  # downgrade reverses only what upgrade created
    for destructive in ["drop_table('users'", "drop_table('portfolios'",
                        "drop_table('holdings'", "drop_table('price_history'",
                        "delete(", "update("]:
        assert destructive not in src
