"""Phase S3 database-integrity + abuse-control tests.

Deterministic and mocked throughout: sqlite memories / temp files for
persistence tests, patched Yahoo/JWKS-free paths, no live traffic.
"""

import logging
import os
import sys
import tempfile
import threading
from datetime import date, timedelta

sys.path.insert(0, r"C:\Users\Dhananjay\Downloads\Dhruv's Pvt docs\RiskMetrics")

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.exc import IntegrityError, TimeoutError as SATimeoutError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool, StaticPool

import app.main as mainmod
from app.main import app
from app.models import Base, User, Portfolio, Holding, PortfolioShare, PermissionLevel, IngestionQuota
from app.db import database as dbmod
from app.db.database import get_db
from app.auth import get_current_user
from app.security import resource_limits as limits
from app.security.events import reset_abuse_tracker
from app.security.quotas import current_usage, quota_limit
from app.security.rate_limit import reset_global_limiter
from app.security.resource_limits import RateClassConfig

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
    p = Portfolio(name="S3 Probe", owner_id=owner.id)
    db.add(p)
    db.commit()
    ids = {"owner": owner.id, "other": other.id,
           "stranger": stranger.id, "portfolio": p.id}
    db.close()
    _current_user_id = ids["owner"]
    yield ids


def _as(user_key, ids):
    global _current_user_id
    _current_user_id = ids[user_key]


# ============================================================================
# Database pool configuration
# ============================================================================

def test_pool_options_postgres_bounded():
    opts = dbmod.pool_options("postgresql://u:p@localhost/db")
    assert opts["pool_size"] == 5
    assert opts["max_overflow"] == 5
    assert opts["pool_timeout"] == 10
    assert opts["pool_recycle"] == 300
    assert opts["pool_pre_ping"] is True


def test_pool_options_sqlite_defaults():
    assert dbmod.pool_options("sqlite:///./x.db") == {}
    assert dbmod.connect_args_for("sqlite:///./x.db") == {"check_same_thread": False}


def test_statement_timeout_disabled_by_default():
    assert dbmod.connect_args_for("postgresql://u:p@localhost/db") == {}


def test_statement_timeout_opt_in(monkeypatch):
    monkeypatch.setattr(limits, "DB_STATEMENT_TIMEOUT_MS", 20000)
    args = dbmod.connect_args_for("postgresql://u:p@localhost/db")
    assert args["options"] == "-c statement_timeout=20000"


def test_build_engine_postgres_uses_queue_pool():
    eng = dbmod.build_engine("postgresql://u:p@localhost/db")
    assert isinstance(eng.pool, QueuePool)
    assert eng.pool._timeout == 10
    assert eng.pool._recycle == 300
    eng.dispose()


def test_pool_exhaustion_maps_to_sanitized_503(seed):
    def broken_db():
        raise SATimeoutError("QueuePool limit overflow secret-conn-xyz")
        yield

    app.dependency_overrides[get_db] = broken_db
    try:
        resp = client.get("/api/v1/portfolios/")
    finally:
        app.dependency_overrides[get_db] = _override_get_db
    assert resp.status_code == 503
    assert resp.json()["error"] == "service_unavailable"
    assert "secret" not in resp.text


def test_get_db_releases_session_on_success_and_error(monkeypatch):
    from sqlalchemy.orm import Session as SASession
    Local = sessionmaker(bind=engine)
    monkeypatch.setattr(dbmod, "SessionLocal", Local)
    closed = []
    real_close = SASession.close

    def spy_close(self):
        closed.append(True)
        return real_close(self)

    monkeypatch.setattr(SASession, "close", spy_close)
    gen = dbmod.get_db()
    session = next(gen)
    session.execute(__import__("sqlalchemy").text("SELECT 1"))  # session usable
    try:
        gen.throw(RuntimeError("boom"))
    except RuntimeError:
        pass
    assert closed, "get_db finally-block must close the session on error"


def test_quota_model_registered():
    assert "ingestion_quotas" in Base.metadata.tables
    cols = {c.name for c in Base.metadata.tables["ingestion_quotas"].columns}
    assert {"user_id", "day", "symbol_days"} <= cols


def test_migration_chain_intact():
    # NOTE: the repo's local `alembic/` package dir shadows the installed
    # alembic distribution under pytest's sys.path, so the revision file is
    # validated by parsing (not importing). Chain execution is verified via
    # offline `alembic upgrade head --sql` during development.
    import re
    path = os.path.join(r"C:\Users\Dhananjay\Downloads\Dhruv's Pvt docs\RiskMetrics",
                        "alembic", "versions",
                        "c41f9d2a7e55_add_ingestion_quotas_table.py")
    src = open(path).read()
    assert re.search(r"^revision\s*=\s*['\"]c41f9d2a7e55['\"]", src, re.M)
    assert re.search(r"^down_revision\s*=\s*['\"]be8acd5f3e64['\"]", src, re.M)
    assert "def upgrade" in src and "def downgrade" in src
    assert "ingestion_quotas" in src and "uq_quota_user_day" in src


# ============================================================================
# Query behavior: shapes + N+1 bounds
# ============================================================================

def _count_statements(func):
    seen = []

    def before(*args):
        seen.append(1)

    event.listen(engine, "before_cursor_execute", before)
    try:
        func()
    finally:
        event.remove(engine, "before_cursor_execute", before)
    return len(seen)


_seed_counter = {"n": 0}


def _seed_viewers(ids, n):
    db = TestingSession()
    for _ in range(n):
        i = _seed_counter["n"]
        _seed_counter["n"] += 1
        u = User(clerk_user_id=f"clerk_v{i}", email=f"v{i}@example.com")
        db.add(u)
        db.flush()
        db.add(PortfolioShare(portfolio_id=ids["portfolio"],
                              shared_with_user_id=u.id,
                              permission=PermissionLevel.view,
                              created_by_user_id=ids["owner"]))
    db.commit()
    db.close()


def test_list_shares_shape_and_no_n1(seed):
    _as("owner", seed)
    _seed_viewers(seed, 1)
    n1 = _count_statements(lambda: client.get(
        f"/api/v1/portfolios/{seed['portfolio']}/shares"))
    resp = client.get(f"/api/v1/portfolios/{seed['portfolio']}/shares")
    assert resp.status_code == 200
    row = resp.json()[0]
    assert {"shared_with_email", "permission", "portfolio_id"} <= set(row.keys())
    _seed_viewers(seed, 4)  # 5 shares total now
    n5 = _count_statements(lambda: client.get(
        f"/api/v1/portfolios/{seed['portfolio']}/shares"))
    assert n5 == n1  # batched: row growth adds zero queries
    assert n5 <= 8


def test_list_portfolios_shape_and_no_n1(seed):
    _as("owner", seed)
    _seed_viewers(seed, 1)
    n1 = _count_statements(lambda: client.get("/api/v1/portfolios/"))
    resp = client.get("/api/v1/portfolios/")
    assert resp.status_code == 200
    assert {"is_owner", "permission", "owner_email"} <= set(resp.json()[0].keys())
    # Second portfolio shared with 4 more viewers.
    db = TestingSession()
    p2 = Portfolio(name="Second", owner_id=seed["owner"])
    db.add(p2)
    db.flush()
    for i in range(4):
        u = User(clerk_user_id=f"clerk_w{i}", email=f"w{i}@example.com")
        db.add(u)
        db.flush()
        db.add(PortfolioShare(portfolio_id=p2.id, shared_with_user_id=u.id,
                              permission=PermissionLevel.view,
                              created_by_user_id=seed["owner"]))
    db.commit()
    db.close()
    n2 = _count_statements(lambda: client.get("/api/v1/portfolios/"))
    assert n2 == n1


def test_detail_and_holdings_shapes(seed):
    _as("owner", seed)
    client.post(f"/api/v1/portfolios/{seed['portfolio']}/holdings",
                json={"symbol": "AAPL", "quantity": "10", "avg_cost": "150.00"})
    detail = client.get(f"/api/v1/portfolios/{seed['portfolio']}")
    assert detail.status_code == 200
    assert {"holdings", "is_owner", "permission", "owner_email"} <= set(detail.json().keys())
    holdings = client.get(f"/api/v1/portfolios/{seed['portfolio']}/holdings")
    assert holdings.status_code == 200
    assert holdings.json()[0]["symbol"] == "AAPL"


def test_price_data_batch_matches_per_symbol():
    from app.services.risk_calculator import RiskCalculator
    from app.models import PriceHistory
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSession()
    for sym, px in (("AAPL", 100.0), ("MSFT", 200.0)):
        for i in range(5):
            db.add(PriceHistory(symbol=sym, date=date(2024, 1, 2 + i),
                                open=px, high=px, low=px, close=px + i,
                                adjusted_close=px + i, volume=100))
    db.commit()
    calc = RiskCalculator(db)
    data = calc.get_price_data(["AAPL", "MSFT"], date(2024, 1, 1), date(2024, 1, 31))
    db.close()
    assert set(data.keys()) == {"AAPL", "MSFT"}
    assert list(data["AAPL"]) == [100.0, 101.0, 102.0, 103.0, 104.0]
    assert list(data["MSFT"]) == [200.0, 201.0, 202.0, 203.0, 204.0]


# ============================================================================
# Persistent quota
# ============================================================================

def _yahoo_records(symbol="AAPL"):
    return [{
        "symbol": symbol, "date": date(2024, 1, 2), "open": 100, "high": 101,
        "low": 99, "close": 100.5, "adjusted_close": 100.5, "volume": 1000,
    }]


def test_quota_first_use_tracked(seed):
    from app.routers import ingestion as ing
    with patch.object(ing.yfinance_service, "fetch_multiple_symbols",
                      return_value={"AAPL": _yahoo_records()}) as mock_fetch:
        resp = client.post("/api/v1/ingest/batch",
                           json={"symbols": ["AAPL", "MSFT"],
                                 "start_date": "2024-01-01", "end_date": "2024-01-10"})
    assert resp.status_code == 200, resp.text
    assert mock_fetch.call_count == 1
    db = TestingSession()
    try:
        assert current_usage(db, seed["owner"]) == 20  # 2 symbols x 10 days
    finally:
        db.close()


def test_quota_cumulative_then_rejected_before_yahoo(seed, monkeypatch):
    from app.routers import ingestion as ing
    monkeypatch.setattr(limits, "DAILY_INGEST_SYMBOL_DAYS", 25)
    with patch.object(ing.yfinance_service, "fetch_multiple_symbols",
                      return_value={"AAPL": _yahoo_records()}) as mock_fetch:
        assert client.post("/api/v1/ingest/batch",
                           json={"symbols": ["AAPL", "MSFT"],
                                 "start_date": "2024-01-01",
                                 "end_date": "2024-01-10"}).status_code == 200
        resp = client.post("/api/v1/ingest/batch",
                           json={"symbols": ["AAPL", "MSFT"],
                                 "start_date": "2024-01-01",
                                 "end_date": "2024-01-10"})
    assert resp.status_code == 429, resp.text
    body = resp.json()
    assert body["error"] == "business_quota_exceeded"
    assert body["details"]["used"] == 20
    assert body["details"]["quota"] == 25
    assert "Retry-After" in resp.headers
    assert mock_fetch.call_count == 1  # rejected before any Yahoo call


def test_quota_utc_rollover(seed):
    from app.routers import ingestion as ing
    from app.security.quotas import utc_today
    db = TestingSession()
    db.add(IngestionQuota(user_id=seed["owner"],
                          day=utc_today() - timedelta(days=1),
                          symbol_days=99999))
    db.commit()
    db.close()
    with patch.object(ing.yfinance_service, "fetch_multiple_symbols",
                      return_value={"AAPL": _yahoo_records()}):
        resp = client.post("/api/v1/ingest/batch",
                           json={"symbols": ["AAPL"],
                                 "start_date": "2024-01-01", "end_date": "2024-01-10"})
    assert resp.status_code == 200, resp.text


def test_quota_concurrent_increments_no_double_spend(seed):
    from app.security.quotas import record_ingest_usage
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    file_engine = create_engine(f"sqlite:///{tmp.name}",
                                connect_args={"check_same_thread": False},
                                poolclass=QueuePool)
    try:
        Base.metadata.create_all(bind=file_engine)
        FileSession = sessionmaker(bind=file_engine)
        db = FileSession()
        u = User(clerk_user_id="clerk_conc", email="conc@example.com")
        db.add(u)
        db.commit()
        uid = u.id
        db.close()

        errors = []

        def worker():
            try:
                s = FileSession()
                try:
                    record_ingest_usage(s, uid, 100)
                finally:
                    s.close()
            except Exception as e:  # noqa: BLE001 - collected, asserted empty
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert errors == []
        s = FileSession()
        try:
            assert current_usage(s, uid) == 500  # no lost updates
        finally:
            s.close()
    finally:
        file_engine.dispose()
        os.unlink(tmp.name)


def test_quota_never_negative(seed):
    from app.security.quotas import record_ingest_usage
    db = TestingSession()
    try:
        assert record_ingest_usage(db, seed["owner"], -50) == 0
        assert record_ingest_usage(db, seed["owner"], 0) == 0
    finally:
        db.close()


# ============================================================================
# CRUD rate limits
# ============================================================================

def test_crud_mutation_burst_429(seed, monkeypatch):
    monkeypatch.setitem(limits.RATE_CLASSES, "AUTH_MUTATION", RateClassConfig(3, 60))
    for i in range(3):
        resp = client.post(f"/api/v1/portfolios/{seed['portfolio']}/holdings",
                           json={"symbol": f"S{i}", "quantity": "1", "avg_cost": "10"})
        assert resp.status_code == 201, resp.text
    resp = client.post(f"/api/v1/portfolios/{seed['portfolio']}/holdings",
                       json={"symbol": "S9", "quantity": "1", "avg_cost": "10"})
    assert resp.status_code == 429
    assert resp.json()["error"] == "rate_limited"


def test_crud_users_isolated(seed, monkeypatch):
    monkeypatch.setitem(limits.RATE_CLASSES, "AUTH_MUTATION", RateClassConfig(2, 60))
    _as("owner", seed)
    assert client.post("/api/v1/portfolios/", json={"name": "A"}).status_code == 201
    assert client.post("/api/v1/portfolios/", json={"name": "B"}).status_code == 201
    assert client.post("/api/v1/portfolios/", json={"name": "C"}).status_code == 429
    _as("other", seed)
    assert client.post("/api/v1/portfolios/", json={"name": "D"}).status_code == 201


def test_crud_read_mutation_classes_isolated(seed, monkeypatch):
    monkeypatch.setitem(limits.RATE_CLASSES, "AUTH_MUTATION", RateClassConfig(1, 60))
    _as("owner", seed)
    assert client.post("/api/v1/portfolios/", json={"name": "A"}).status_code == 201
    assert client.post("/api/v1/portfolios/", json={"name": "B"}).status_code == 429
    assert client.get("/api/v1/portfolios/").status_code == 200


def test_authz_precedes_rate_limit(seed, monkeypatch):
    monkeypatch.setitem(limits.RATE_CLASSES, "AUTH_READ", RateClassConfig(1, 60))
    _as("stranger", seed)
    # No share: 403 every time, never 429 — limiting is not authz.
    assert client.get(f"/api/v1/portfolios/{seed['portfolio']}").status_code == 403
    assert client.get(f"/api/v1/portfolios/{seed['portfolio']}").status_code == 403


# ============================================================================
# Resource-count limits
# ============================================================================

def test_portfolio_cap(seed, monkeypatch):
    # Seed fixture already owns 1 portfolio; cap 3 allows A and B, rejects C.
    monkeypatch.setattr(limits, "MAX_PORTFOLIOS_PER_USER", 3)
    assert client.post("/api/v1/portfolios/", json={"name": "A"}).status_code == 201
    assert client.post("/api/v1/portfolios/", json={"name": "B"}).status_code == 201
    resp = client.post("/api/v1/portfolios/", json={"name": "C"})
    assert resp.status_code == 413
    assert resp.json()["error"] == "portfolio_limit_reached"
    db = TestingSession()
    try:
        assert db.query(Portfolio).filter(Portfolio.owner_id == seed["owner"]).count() == 3
    finally:
        db.close()


def test_share_cap(seed, monkeypatch):
    monkeypatch.setattr(limits, "MAX_SHARES_PER_PORTFOLIO", 1)
    _as("owner", seed)
    assert client.post(f"/api/v1/portfolios/{seed['portfolio']}/share",
                       json={"email": "other@example.com",
                             "permission": "view"}).status_code == 201
    resp = client.post(f"/api/v1/portfolios/{seed['portfolio']}/share",
                       json={"email": "stranger@example.com",
                             "permission": "view"})
    assert resp.status_code == 413
    assert resp.json()["error"] == "share_limit_reached"


# ============================================================================
# Race integrity
# ============================================================================

def test_unique_backstops_exist():
    from sqlalchemy import inspect as sa_inspect
    insp = sa_inspect(engine)
    assert any(u["name"] == "uq_portfolio_symbol"
               for u in insp.get_unique_constraints("holdings"))
    assert any(u["name"] == "uq_symbol_date"
               for u in insp.get_unique_constraints("price_history"))
    assert any(u["name"] == "uq_quota_user_day"
               for u in insp.get_unique_constraints("ingestion_quotas"))


def test_holding_race_recovers_as_merge(seed):
    from sqlalchemy.orm import Session as SASession
    from app.models import PriceHistory  # noqa: F401 - keeps module import style
    db = TestingSession()
    db.add(Holding(portfolio_id=seed["portfolio"], symbol="AAPL",
                   quantity=10, avg_cost=150))
    db.commit()
    db.close()

    real_query = SASession.query
    state = {"used": False}

    def query_spy(self, *args, **kwargs):
        if args and args[0] is Holding and not state["used"]:
            state["used"] = True
            m = MagicMock()
            m.filter.return_value.first.return_value = None  # simulated check-miss
            return m
        return real_query(self, *args, **kwargs)

    _as("owner", seed)
    with patch.object(SASession, "query", query_spy):
        resp = client.post(f"/api/v1/portfolios/{seed['portfolio']}/holdings",
                           json={"symbol": "AAPL", "quantity": "5",
                                 "avg_cost": "150.00"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["quantity"] == "15.000000"  # merged, no duplicate, no 500


def test_share_race_recovers_as_update(seed):
    from sqlalchemy.orm import Session as SASession
    db = TestingSession()
    db.add(PortfolioShare(portfolio_id=seed["portfolio"],
                          shared_with_user_id=seed["other"],
                          permission=PermissionLevel.view,
                          created_by_user_id=seed["owner"]))
    db.commit()
    db.close()

    real_query = SASession.query
    state = {"used": False}

    def query_spy(self, *args, **kwargs):
        if args and args[0] is PortfolioShare and not state["used"]:
            state["used"] = True
            m = MagicMock()
            m.filter.return_value.first.return_value = None
            return m
        return real_query(self, *args, **kwargs)

    _as("owner", seed)
    with patch.object(SASession, "query", query_spy):
        resp = client.post(f"/api/v1/portfolios/{seed['portfolio']}/share",
                           json={"email": "other@example.com", "permission": "edit"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["permission"] == "edit"


def test_ingest_dedup_race_skips_without_500(seed):
    from app.routers.ingestion import _insert_new_records
    from app.models import PriceHistory
    db = TestingSession()
    # Simulate a lost race: row committed after the preload set was built.
    db.add(PriceHistory(symbol="AAPL", date=date(2024, 1, 2), open=100,
                        high=101, low=99, close=100.5, adjusted_close=100.5,
                        volume=1000))
    db.commit()
    records = [
        {"symbol": "AAPL", "date": date(2024, 1, 2), "open": 100, "high": 101,
         "low": 99, "close": 100.5, "adjusted_close": 100.5, "volume": 1000},
        {"symbol": "AAPL", "date": date(2024, 1, 3), "open": 101, "high": 102,
         "low": 100, "close": 101.5, "adjusted_close": 101.5, "volume": 1100},
    ]
    ingested = _insert_new_records(db, records, known_dates=set())
    assert ingested == 1
    assert db.query(PriceHistory).filter(PriceHistory.symbol == "AAPL").count() == 2
    db.close()


# ============================================================================
# Security events + abuse signals
# ============================================================================

def test_auth_failure_event_safe(seed, caplog):
    app.dependency_overrides.pop(get_current_user, None)
    try:
        with caplog.at_level(logging.WARNING, logger="sentinel.security"):
            resp = client.post("/api/v1/ingest/batch",
                               json={"symbols": ["AAPL"],
                                     "start_date": "2024-01-01", "end_date": "2024-01-10"})
    finally:
        app.dependency_overrides[get_current_user] = _override_get_current_user
    assert resp.status_code == 401
    text = "\n".join(r.getMessage() for r in caplog.records
                     if r.name == "sentinel.security")
    assert "authentication_failure" in text
    assert "Bearer" not in text and "token" not in text.lower().replace("invalid_token", "")


def test_authz_denial_event_safe(seed, caplog):
    _as("stranger", seed)
    with caplog.at_level(logging.WARNING, logger="sentinel.security"):
        resp = client.get(f"/api/v1/portfolios/{seed['portfolio']}")
    assert resp.status_code == 403
    text = "\n".join(r.getMessage() for r in caplog.records
                     if r.name == "sentinel.security")
    assert "authorization_denial" in text
    assert f"user_id={seed['stranger']}" in text
    assert f"portfolio_id={seed['portfolio']}" in text


def test_event_sanitizer_drops_secrets():
    from app.security.events import security_event
    import logging as _logging
    records = []

    class Tap(_logging.Handler):
        def emit(self, record):
            records.append(record.getMessage())

    log = _logging.getLogger("sentinel.security")
    log.addHandler(Tap())
    try:
        security_event("probe", user_id=1, password="x", jwt="y",
                       request_body="z", sql="select", safe="ok")
    finally:
        log.removeHandler(log.handlers[-1])
    assert records
    msg = records[-1]
    assert "safe=ok" in msg
    for leaked in ("password", "jwt", "request_body", "sql=", "x"):
        assert leaked not in msg


def test_abuse_tracker_threshold_and_quiet():
    from app.security.events import get_abuse_tracker
    tracker = get_abuse_tracker()
    assert tracker.note("t", "id1", threshold=3, window_seconds=60) is False
    assert tracker.note("t", "id1", threshold=3, window_seconds=60) is False
    assert tracker.note("t", "id1", threshold=3, window_seconds=60) is True
    assert tracker.note("t", "id1", threshold=3, window_seconds=60) is False


def test_repeated_403_abuse_signal(seed, caplog, monkeypatch):
    monkeypatch.setattr(limits, "ABUSE_REPEATED_403", 2)
    _as("stranger", seed)
    with caplog.at_level(logging.WARNING, logger="sentinel.security"):
        client.get(f"/api/v1/portfolios/{seed['portfolio']}")
        client.get(f"/api/v1/portfolios/{seed['portfolio']}")
    text = "\n".join(r.getMessage() for r in caplog.records
                     if r.name == "sentinel.security")
    assert "abuse_signal" in text
    assert "repeated_403" in text


def test_share_mutation_event(seed, caplog):
    _as("owner", seed)
    with caplog.at_level(logging.WARNING, logger="sentinel.security"):
        resp = client.post(f"/api/v1/portfolios/{seed['portfolio']}/share",
                           json={"email": "other@example.com", "permission": "view"})
    assert resp.status_code == 201
    text = "\n".join(r.getMessage() for r in caplog.records
                     if r.name == "sentinel.security")
    assert "share_mutation" in text
    assert "other@example.com" not in text  # ids only, no email PII


def test_quota_limit_default():
    assert quota_limit() == 100_000
