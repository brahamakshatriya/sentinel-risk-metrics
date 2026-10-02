"""Phase S2 security-hardening tests. All external I/O mocked; no live
Yahoo / FRED / Clerk / Render / Neon traffic."""

import base64
import sys
import time
from datetime import date

sys.path.insert(0, r"C:\Users\Dhananjay\Downloads\Dhruv's Pvt docs\RiskMetrics")

from unittest.mock import MagicMock, patch

import pandas as pd
import pytest
import requests
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt

import app.main as mainmod
from app.main import app, create_app, docs_enabled
from app.models import Base, User, Portfolio, Holding
from app.db.database import get_db
from app.auth import get_current_user
from app.security import resource_limits as limits
from app.security.rate_limit import reset_global_limiter

import app.services.yfinance_service as _yf_pkg_attr  # noqa: F401 (see below)
import app.services.riskfree_service as fredmod
import app.auth as authmod

# NOTE: app/services/__init__.py rebinds the `yfinance_service` attribute to
# the singleton instance, so `import ... as` yields the instance, not the
# module. Resolve the real module (for timeout/retry monkeypatching) and the
# singleton (for fetch calls) explicitly.
yfmod = sys.modules["app.services.yfinance_service"]
yfsingleton = yfmod.yfinance_service

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
    db.add(owner)
    db.flush()
    p = Portfolio(name="S2 Probe", owner_id=owner.id)
    db.add(p)
    db.commit()
    ids = {"owner": owner.id, "portfolio": p.id}
    db.close()
    _current_user_id = ids["owner"]
    yield ids


# ============================================================================
# Yahoo hardening
# ============================================================================

def _price_frame():
    idx = pd.date_range("2024-01-02", periods=2, freq="D")
    return pd.DataFrame(
        {"Open": [100.0, 101.0], "High": [101.0, 102.0], "Low": [99.0, 100.0],
         "Close": [100.5, 101.5], "Adj Close": [100.5, 101.5],
         "Volume": [1000, 1100]},
        index=idx,
    )


def _mock_ticker(history_side_effect):
    ticker = MagicMock()
    ticker.history.side_effect = history_side_effect
    return ticker


def test_yahoo_success_single_call():
    ticker = _mock_ticker([_price_frame()])
    with patch("yfinance.Ticker", return_value=ticker):
        records = yfsingleton.fetch_price_history(
            "AAPL", date(2024, 1, 1), date(2024, 1, 10))
    assert len(records) == 2
    assert ticker.history.call_count == 1
    # Explicit timeout is passed through to the provider call.
    _, kwargs = ticker.history.call_args
    assert kwargs.get("timeout") == yfmod._timeout_seconds()
    assert records[0]["symbol"] == "AAPL"
    assert float(records[0]["close"]) == 100.5


def test_yahoo_transient_failure_retried_once_then_succeeds():
    ticker = _mock_ticker([requests.exceptions.ConnectTimeout(), _price_frame()])
    with patch("yfinance.Ticker", return_value=ticker):
        records = yfsingleton.fetch_price_history(
            "AAPL", date(2024, 1, 1), date(2024, 1, 10))
    assert len(records) == 2
    assert ticker.history.call_count == 2


def test_yahoo_retry_exhaustion_bounded():
    ticker = _mock_ticker([requests.exceptions.ConnectTimeout()] * 5)
    with patch("yfinance.Ticker", return_value=ticker):
        records = yfsingleton.fetch_price_history(
            "AAPL", date(2024, 1, 1), date(2024, 1, 10))
    assert records == []
    assert ticker.history.call_count == 2  # initial + exactly one retry


def test_yahoo_no_retry_for_non_transient_failure():
    ticker = _mock_ticker([ValueError("bad interval")])
    with patch("yfinance.Ticker", return_value=ticker):
        records = yfsingleton.fetch_price_history(
            "AAPL", date(2024, 1, 1), date(2024, 1, 10))
    assert records == []
    assert ticker.history.call_count == 1


def test_yahoo_no_retry_amplification_when_retries_disabled(monkeypatch):
    monkeypatch.setattr(yfmod, "_YAHOO_RETRIES", 0)
    ticker = _mock_ticker([requests.exceptions.ConnectTimeout()] * 5)
    with patch("yfinance.Ticker", return_value=ticker):
        records = yfsingleton.fetch_price_history(
            "AAPL", date(2024, 1, 1), date(2024, 1, 10))
    assert records == []
    assert ticker.history.call_count == 1


def test_yahoo_builtin_timeout_is_transient():
    ticker = _mock_ticker([TimeoutError("timed out"), _price_frame()])
    with patch("yfinance.Ticker", return_value=ticker):
        records = yfsingleton.fetch_price_history(
            "AAPL", date(2024, 1, 1), date(2024, 1, 10))
    assert len(records) == 2
    assert ticker.history.call_count == 2


# ============================================================================
# FRED hardening
# ============================================================================

def _fred_series(value=5.25):
    return pd.Series([value])


@pytest.fixture()
def _fred_key(monkeypatch):
    monkeypatch.setattr(fredmod, "FRED_API_KEY", "test-key")
    fredmod.clear_cache()
    yield


def test_fred_success(_fred_key):
    with patch("fredapi.Fred") as mock_fred:
        mock_fred.return_value.get_series.return_value = _fred_series()
        rate = fredmod.get_risk_free_rate(None)
    assert rate == pytest.approx(0.0525)
    assert mock_fred.call_count == 1


def test_fred_transient_then_success_one_retry(_fred_key):
    with patch("fredapi.Fred") as mock_fred:
        mock_fred.return_value.get_series.side_effect = [
            requests.exceptions.ConnectTimeout(), _fred_series()]
        rate = fredmod.get_risk_free_rate(None)
    assert rate == pytest.approx(0.0525)
    assert mock_fred.return_value.get_series.call_count == 2


def test_fred_persistent_failure_falls_back_to_default(_fred_key):
    with patch("fredapi.Fred") as mock_fred:
        mock_fred.return_value.get_series.side_effect = requests.exceptions.ConnectionError()
        rate = fredmod.get_risk_free_rate(None)
    assert rate == fredmod.DEFAULT_RATE
    assert mock_fred.return_value.get_series.call_count == 2  # bounded


def test_fred_no_retry_on_empty_series(_fred_key):
    with patch("fredapi.Fred") as mock_fred:
        mock_fred.return_value.get_series.return_value = pd.Series([], dtype=float)
        rate = fredmod.get_risk_free_rate(None)
    assert rate == fredmod.DEFAULT_RATE
    assert mock_fred.return_value.get_series.call_count == 1


def test_fred_timeout_bounded(_fred_key, monkeypatch):
    import threading
    monkeypatch.setattr(fredmod, "_FRED_TIMEOUT", 0.2)
    block = threading.Event()

    def hang(*a, **k):
        block.wait(10)
        return _fred_series()

    with patch("fredapi.Fred") as mock_fred:
        mock_fred.return_value.get_series.side_effect = hang
        started = time.monotonic()
        rate = fredmod.get_risk_free_rate(None)
        elapsed = time.monotonic() - started
    assert rate == fredmod.DEFAULT_RATE
    assert elapsed < 5  # two bounded attempts, not the 10s hang
    block.set()


def test_fred_cache_hit_avoids_upstream(_fred_key):
    fredmod._risk_free_cache["rate"] = 0.04
    from datetime import datetime, timedelta
    fredmod._risk_free_cache["fetched_at"] = datetime.utcnow()
    with patch("fredapi.Fred") as mock_fred:
        rate = fredmod.get_risk_free_rate(None)
    assert rate == pytest.approx(0.04)
    mock_fred.assert_not_called()


def test_fred_24h_cache_preserved(_fred_key):
    assert fredmod.CACHE_TTL_HOURS == 24


# ============================================================================
# JWKS hardening
# ============================================================================

ISSUER = "https://test-clerk.accounts.dev"


def _b64url_uint(n: int) -> str:
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _keypair(kid):
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    numbers = private_key.public_key().public_numbers()
    jwk = {"kty": "RSA", "use": "sig", "kid": kid, "alg": "RS256",
           "n": _b64url_uint(numbers.n), "e": _b64url_uint(numbers.e)}
    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()).decode("ascii")
    return pem, jwk


def _resp(jwks):
    r = MagicMock()
    r.json.return_value = jwks
    r.raise_for_status.return_value = None
    return r


@pytest.fixture()
def _clerk_env(monkeypatch):
    monkeypatch.setattr(authmod, "CLERK_JWKS_URL", "https://test/.well-known/jwks.json")
    monkeypatch.setattr(authmod, "CLERK_ISSUER", ISSUER)
    authmod.clear_jwks_cache()
    yield


def _token(private_pem, kid, claims):
    import time as _t
    now = int(_t.time())
    base = {"iss": ISSUER, "iat": now, "exp": now + 600}
    base.update(claims)
    return jwt.encode(base, private_pem, algorithm="RS256", headers={"kid": kid})


def test_jwks_cached_hit(_clerk_env):
    pem, jwk = _keypair("k1")
    with patch.object(authmod.httpx, "get", return_value=_resp({"keys": [jwk]})):
        first = authmod.get_jwks()
    with patch.object(authmod.httpx, "get", side_effect=AssertionError("must not fetch")):
        second = authmod.get_jwks()
    assert first == second


def test_jwks_ttl_expiry_refreshes(_clerk_env):
    _, jwk1 = _keypair("k1")
    _, jwk2 = _keypair("k2")
    with patch.object(authmod.httpx, "get", return_value=_resp({"keys": [jwk1]})):
        authmod.get_jwks()
    authmod._jwks_cache["fetched_at"] = time.monotonic() - 10_000  # expired
    with patch.object(authmod.httpx, "get", return_value=_resp({"keys": [jwk2]})) as mock_get:
        fresh = authmod.get_jwks()
    assert mock_get.call_count == 1
    assert fresh == {"keys": [jwk2]}


def test_jwks_unknown_kid_single_refresh_then_validates(_clerk_env):
    pem1, jwk1 = _keypair("k1")
    pem2, jwk2 = _keypair("k2")
    with patch.object(authmod.httpx, "get", return_value=_resp({"keys": [jwk1]})):
        authmod.get_jwks()
    token = _token(pem2, "k2", {"sub": "user_rot"})
    with patch.object(authmod.httpx, "get", return_value=_resp({"keys": [jwk1, jwk2]})) as mock_get:
        key = authmod.get_signing_key(token)
        payload = jwt.decode(token, key, algorithms=["RS256"], issuer=ISSUER,
                             options={"verify_aud": False})
    assert mock_get.call_count == 1  # exactly one rotation refresh
    assert payload["sub"] == "user_rot"


def test_jwks_known_kid_validates_normally(_clerk_env):
    pem, jwk = _keypair("k1")
    with patch.object(authmod.httpx, "get", return_value=_resp({"keys": [jwk]})):
        payload = authmod.verify_clerk_token(_token(pem, "k1", {"sub": "u1"}))
    assert payload["sub"] == "u1"


def test_jwks_invalid_signature_rejected(_clerk_env):
    pem, jwk = _keypair("k1")
    with patch.object(authmod.httpx, "get", return_value=_resp({"keys": [jwk]})):
        token = _token(pem, "k1", {"sub": "u1"})
        bad = token[:-2] + ("AA" if not token.endswith("AA") else "BB")
        with pytest.raises(HTTPException) as exc:
            authmod.verify_clerk_token(bad)
    assert exc.value.status_code == 401


def test_jwks_wrong_issuer_rejected(_clerk_env):
    pem, jwk = _keypair("k1")
    import time as _t
    now = int(_t.time())
    evil = jwt.encode({"iss": "https://evil.example.com", "sub": "u1",
                       "iat": now, "exp": now + 600},
                      pem, algorithm="RS256", headers={"kid": "k1"})
    with patch.object(authmod.httpx, "get", return_value=_resp({"keys": [jwk]})):
        with pytest.raises(HTTPException) as exc:
            authmod.verify_clerk_token(evil)
    assert exc.value.status_code == 401


def test_jwks_expired_token_rejected(_clerk_env):
    pem, jwk = _keypair("k1")
    import time as _t
    now = int(_t.time())
    old = jwt.encode({"iss": ISSUER, "sub": "u1", "iat": now - 1200, "exp": now - 600},
                     pem, algorithm="RS256", headers={"kid": "k1"})
    with patch.object(authmod.httpx, "get", return_value=_resp({"keys": [jwk]})):
        with pytest.raises(HTTPException) as exc:
            authmod.verify_clerk_token(old)
    assert exc.value.status_code == 401


def test_jwks_refresh_failure_fails_closed(_clerk_env):
    _, jwk1 = _keypair("k1")
    pem2, _ = _keypair("k2-unknown")
    with patch.object(authmod.httpx, "get", return_value=_resp({"keys": [jwk1]})):
        authmod.get_jwks()
    token = _token(pem2, "k2-unknown", {"sub": "intruder"})
    with patch.object(authmod.httpx, "get", side_effect=Exception("net down")):
        with pytest.raises(HTTPException) as exc:
            authmod.get_signing_key(token)
    assert exc.value.status_code in (401, 503)  # closed, never a key


# ============================================================================
# Disclosure hardening
# ============================================================================

def test_health_prod_redacted(monkeypatch):
    monkeypatch.setattr(mainmod, "ENV", "production")

    def boom():
        raise Exception("connection failed: host=db.internal path=/secret/x")

    ctx = MagicMock()
    ctx.__enter__.side_effect = boom
    with patch.object(mainmod, "get_db_session", return_value=ctx):
        resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["database"] == "disconnected"
    assert body["database_error"] is None
    assert "internal" not in resp.text
    assert "secret" not in resp.text


def test_health_dev_verbose(monkeypatch):
    monkeypatch.setattr(mainmod, "ENV", "development")

    def boom():
        raise Exception("connection failed")

    ctx = MagicMock()
    ctx.__enter__.side_effect = boom
    with patch.object(mainmod, "get_db_session", return_value=ctx):
        resp = client.get("/health")
    assert resp.json()["database_error"] == "connection failed"


def test_docs_disabled_in_production():
    prod = create_app("production")
    assert prod.docs_url is None
    assert prod.redoc_url is None
    assert prod.openapi_url is None
    prod_client = TestClient(prod, raise_server_exceptions=False)
    assert prod_client.get("/docs").status_code == 404
    assert prod_client.get("/openapi.json").status_code == 404


def test_docs_available_in_development():
    dev = create_app("development")
    assert dev.docs_url == "/docs"
    dev_client = TestClient(dev, raise_server_exceptions=False)
    assert dev_client.get("/docs").status_code == 200


def test_docs_opt_in_production(monkeypatch):
    monkeypatch.setenv("S2_ENABLE_DOCS", "true")
    prod = create_app("production")
    assert prod.docs_url == "/docs"


def test_exception_sanitized_in_production(seed, monkeypatch):
    monkeypatch.setattr(mainmod, "ENV", "production")

    def broken_db():
        raise RuntimeError("super secret connection string")
        yield  # noqa: unreachable, makes this a generator

    app.dependency_overrides[get_db] = broken_db
    resp = client.get("/api/v1/portfolios/")
    assert resp.status_code == 500
    assert resp.json()["error"] == "internal_server_error"
    assert "secret" not in resp.text


# ============================================================================
# Request-body protection
# ============================================================================

def test_body_normal_payload_accepted(seed):
    resp = client.post("/api/v1/portfolios/", json={"name": "Normal"})
    assert resp.status_code == 201, resp.text


def test_body_oversize_rejected(seed):
    big = "x" * (limits.MAX_BODY_BYTES + 100)
    resp = client.post("/api/v1/portfolios/", json={"name": big})
    assert resp.status_code == 413, resp.text
    assert resp.json()["error"] == "request_too_large"


def test_body_boundary_passes_size_guard(seed):
    # Just under the limit: must pass the size guard and reach validation
    # (name too long -> 422), proving the guard did not fire.
    size = limits.MAX_BODY_BYTES - 100
    big = "x" * size
    resp = client.post("/api/v1/portfolios/", json={"name": big})
    assert resp.status_code == 422, resp.text


def test_body_malformed_remains_validation_error(seed):
    resp = client.post("/api/v1/portfolios/", content=b"{bad json",
                       headers={"Content-Type": "application/json"})
    assert resp.status_code == 422, resp.text


# ============================================================================
# Security headers
# ============================================================================

def test_headers_baseline_present():
    resp = client.get("/health")
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["x-frame-options"] == "DENY"
    assert "referrer-policy" in resp.headers
    assert "permissions-policy" in resp.headers
    assert "strict-transport-security" not in resp.headers  # plain HTTP


def test_headers_hsts_on_https():
    resp = client.get("/health", headers={"X-Forwarded-Proto": "https"})
    assert "strict-transport-security" in resp.headers
    assert "includeSubDomains" in resp.headers["strict-transport-security"]


def test_headers_present_on_error_responses(seed):
    big = "x" * (limits.MAX_BODY_BYTES + 100)
    resp = client.post("/api/v1/portfolios/", json={"name": big})
    assert resp.status_code == 413
    assert resp.headers["x-content-type-options"] == "nosniff"


# ============================================================================
# Financial / input bounds
# ============================================================================

def _holding(seed, symbol="AAPL", quantity="10", avg_cost="150.00"):
    return client.post(f"/api/v1/portfolios/{seed['portfolio']}/holdings",
                       json={"symbol": symbol, "quantity": quantity, "avg_cost": avg_cost})


def test_financial_valid_boundary(seed):
    resp = _holding(seed, quantity="1000000000", avg_cost="10000000")
    assert resp.status_code == 201, resp.text


def test_financial_just_over_boundary(seed):
    assert _holding(seed, quantity="1000000001").status_code == 422
    assert _holding(seed, avg_cost="10000000.01").status_code == 422


def test_financial_zero_and_negative_semantics(seed):
    assert _holding(seed, quantity="0").status_code == 422  # stays strictly positive
    assert _holding(seed, symbol="ZERO", avg_cost="0").status_code == 201  # zero cost valid
    assert _holding(seed, symbol="NEG", quantity="-5").status_code == 422
    assert _holding(seed, symbol="NEGC", avg_cost="-1").status_code == 422


def test_financial_nan_infinity_rejected(seed):
    assert _holding(seed, symbol="N1", quantity="NaN").status_code == 422
    assert _holding(seed, symbol="N2", avg_cost="Infinity").status_code == 422
    assert _holding(seed, symbol="N3", quantity="inf").status_code == 422
    assert _holding(seed, symbol="N4", avg_cost="-Infinity").status_code == 422


def test_financial_update_bounds(seed):
    _holding(seed)
    assert client.put(f"/api/v1/portfolios/{seed['portfolio']}/holdings/AAPL",
                       json={"quantity": "1000000001"}).status_code == 422
    assert client.put(f"/api/v1/portfolios/{seed['portfolio']}/holdings/AAPL",
                       json={"avg_cost": "200.00"}).status_code == 200


def test_holdings_cap(seed):
    from app.security.financial_bounds import MAX_HOLDINGS_PER_PORTFOLIO
    db = TestingSession()
    for i in range(MAX_HOLDINGS_PER_PORTFOLIO):
        db.add(Holding(portfolio_id=seed["portfolio"], symbol=f"S{i:03d}",
                       quantity=1, avg_cost=10))
    db.commit()
    db.close()
    resp = _holding(seed, symbol="OVERFLOW")
    assert resp.status_code == 422, resp.text
    assert "limit" in resp.json()["detail"].lower()
    # Merging into an existing symbol is an update, not a new row: allowed.
    assert _holding(seed, symbol="S000", quantity="1").status_code == 201


def test_holdings_below_cap_allowed(seed):
    from app.security.financial_bounds import MAX_HOLDINGS_PER_PORTFOLIO
    db = TestingSession()
    for i in range(MAX_HOLDINGS_PER_PORTFOLIO - 1):
        db.add(Holding(portfolio_id=seed["portfolio"], symbol=f"S{i:03d}",
                       quantity=1, avg_cost=10))
    db.commit()
    db.close()
    assert _holding(seed, symbol="LASTONE").status_code == 201


# ============================================================================
# S1 invariants intact
# ============================================================================

def test_s1_mc_budget_still_enforced(seed):
    import numpy as np
    from datetime import timedelta
    from app.models import PriceHistory
    db = TestingSession()
    db.add(Holding(portfolio_id=seed["portfolio"], symbol="AAPL", quantity=10, avg_cost=150))
    db.add(Holding(portfolio_id=seed["portfolio"], symbol="MSFT", quantity=5, avg_cost=300))
    db.commit()
    rng = np.random.default_rng(7)
    base = date.today() - timedelta(days=130)
    prices = {"AAPL": 100.0, "MSFT": 200.0}
    day = base
    added = 0
    while added < 90:
        day += timedelta(days=1)
        if day.weekday() >= 5:
            continue
        for s in ("AAPL", "MSFT"):
            prices[s] *= 1 + float(rng.normal(0.0005, 0.01))
            px = prices[s]
            db.add(PriceHistory(symbol=s, date=day, open=px, high=px, low=px,
                                close=px, adjusted_close=px, volume=1000))
        added += 1
    db.commit()
    db.close()
    resp = client.post(
        f"/api/v1/portfolios/{seed['portfolio']}/monte-carlo",
        json={"portfolio_id": seed["portfolio"], "lookback_days": 252,
              "num_simulations": 20000, "horizon_days": 1260,
              "confidence_level": 0.95})
    assert resp.status_code == 413
    assert resp.json()["error"] == "compute_budget_exceeded"


def test_s1_ingest_auth_still_enforced():
    app.dependency_overrides.pop(get_current_user, None)
    try:
        resp = client.post("/api/v1/ingest/batch",
                           json={"symbols": ["AAPL"], "start_date": "2024-01-01",
                                 "end_date": "2024-01-10"})
    finally:
        app.dependency_overrides[get_current_user] = _override_get_current_user
    assert resp.status_code == 401
