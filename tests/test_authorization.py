import sys
sys.path.insert(0, r"C:\Users\Dhananjay\Downloads\Dhruv's Pvt docs\RiskMetrics")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.models import Base, User, Portfolio, PortfolioShare, PermissionLevel
from app.db.database import get_db
from app.auth import get_current_user

# Single shared in-memory DB across TestClient requests (same process).
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


# NOTE: TestClient is intentionally NOT used as a context manager so the
# app lifespan (which would touch the real DATABASE_URL engine) never runs.
# All DB access in these tests goes through the overridden get_db below.
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


@pytest.fixture()
def seed():
    global _current_user_id
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSession()
    owner = User(clerk_user_id="clerk_owner", email="owner@example.com")
    viewer = User(clerk_user_id="clerk_viewer", email="viewer@example.com")
    editor = User(clerk_user_id="clerk_editor", email="editor@example.com")
    stranger = User(clerk_user_id="clerk_stranger", email="stranger@example.com")
    db.add_all([owner, viewer, editor, stranger])
    db.flush()
    portfolio = Portfolio(name="Owner Portfolio", owner_id=owner.id)
    db.add(portfolio)
    db.flush()
    db.add(PortfolioShare(portfolio_id=portfolio.id, shared_with_user_id=viewer.id,
                          permission=PermissionLevel.view, created_by_user_id=owner.id))
    db.add(PortfolioShare(portfolio_id=portfolio.id, shared_with_user_id=editor.id,
                          permission=PermissionLevel.edit, created_by_user_id=owner.id))
    db.commit()
    ids = {"owner": owner.id, "viewer": viewer.id, "editor": editor.id,
           "stranger": stranger.id, "portfolio": portfolio.id}
    db.close()
    _current_user_id = ids["owner"]
    yield ids


def _as(user_key, ids):
    global _current_user_id
    _current_user_id = ids[user_key]


def test_owner_can_view_own_portfolio(seed):
    """A. Owner opens own portfolio -> 200 with is_owner=true."""
    _as("owner", seed)
    resp = client.get(f"/api/v1/portfolios/{seed['portfolio']}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_owner"] is True
    assert body["permission"] is None
    assert body["owner_email"] == "owner@example.com"


def test_non_owner_cannot_view_private_portfolio(seed):
    """B. Stranger with no share -> 403 (not 200, not public)."""
    _as("stranger", seed)
    resp = client.get(f"/api/v1/portfolios/{seed['portfolio']}")
    assert resp.status_code == 403, resp.text


def test_shared_viewer_can_view_portfolio(seed):
    """C. View-shared user -> 200 with permission=view, is_owner=false."""
    _as("viewer", seed)
    resp = client.get(f"/api/v1/portfolios/{seed['portfolio']}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_owner"] is False
    assert body["permission"] == "view"
    assert body["owner_email"] == "owner@example.com"


def test_shared_editor_has_edit_permission(seed):
    """D. Edit-shared user sees permission=edit and can add holdings."""
    _as("editor", seed)
    resp = client.get(f"/api/v1/portfolios/{seed['portfolio']}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["permission"] == "edit"
    add = client.post(
        f"/api/v1/portfolios/{seed['portfolio']}/holdings",
        json={"symbol": "AAPL", "quantity": "10", "avg_cost": "150.00"},
    )
    assert add.status_code == 201, add.text
    # A viewer must NOT be able to add holdings.
    _as("viewer", seed)
    denied = client.post(
        f"/api/v1/portfolios/{seed['portfolio']}/holdings",
        json={"symbol": "MSFT", "quantity": "5", "avg_cost": "300.00"},
    )
    assert denied.status_code == 403, denied.text


def test_unknown_portfolio_returns_404(seed):
    """E. Unknown id -> 404, not 403/500."""
    _as("owner", seed)
    resp = client.get("/api/v1/portfolios/999999")
    assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# OWNER > EDIT > VIEW semantics: holdings CRUD, portfolio settings, shares,
# and portfolio deletion. Backend must enforce what the UI gates.
# ---------------------------------------------------------------------------

def _add_holding_as_owner(seed, symbol="AAPL"):
    _as("owner", seed)
    resp = client.post(
        f"/api/v1/portfolios/{seed['portfolio']}/holdings",
        json={"symbol": symbol, "quantity": "10", "avg_cost": "150.00"},
    )
    assert resp.status_code == 201, resp.text


def test_editor_can_update_and_delete_holdings(seed):
    """EDIT can perform all permitted holding operations (update + delete)."""
    _add_holding_as_owner(seed)
    _as("editor", seed)
    updated = client.put(
        f"/api/v1/portfolios/{seed['portfolio']}/holdings/AAPL",
        json={"quantity": "20"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["quantity"] == "20.000000"
    deleted = client.delete(f"/api/v1/portfolios/{seed['portfolio']}/holdings/AAPL")
    assert deleted.status_code == 204, deleted.text


def test_viewer_cannot_modify_holdings(seed):
    """VIEW receives 403 for every holding mutation (add/update/delete)."""
    _add_holding_as_owner(seed)
    _as("viewer", seed)
    pid = seed["portfolio"]
    assert client.post(
        f"/api/v1/portfolios/{pid}/holdings",
        json={"symbol": "MSFT", "quantity": "5", "avg_cost": "300.00"},
    ).status_code == 403
    assert client.put(
        f"/api/v1/portfolios/{pid}/holdings/AAPL",
        json={"quantity": "99"},
    ).status_code == 403
    assert client.delete(
        f"/api/v1/portfolios/{pid}/holdings/AAPL"
    ).status_code == 403


def test_stranger_cannot_modify_holdings(seed):
    """No share -> 403 on holding mutations (not 404 leak, not success)."""
    _as("stranger", seed)
    pid = seed["portfolio"]
    assert client.post(
        f"/api/v1/portfolios/{pid}/holdings",
        json={"symbol": "MSFT", "quantity": "5", "avg_cost": "300.00"},
    ).status_code == 403


def test_only_owner_can_update_portfolio_settings(seed):
    """Portfolio rename is owner-only: EDIT and VIEW both get 403."""
    pid = seed["portfolio"]
    _as("editor", seed)
    assert client.put(f"/api/v1/portfolios/{pid}", json={"name": "Hacked"}).status_code == 403
    _as("viewer", seed)
    assert client.put(f"/api/v1/portfolios/{pid}", json={"name": "Hacked"}).status_code == 403
    _as("owner", seed)
    resp = client.put(f"/api/v1/portfolios/{pid}", json={"name": "Renamed"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Renamed"


def test_only_owner_can_delete_portfolio(seed):
    """Portfolio deletion is owner-only: EDIT/VIEW/stranger get 403."""
    pid = seed["portfolio"]
    _as("editor", seed)
    assert client.delete(f"/api/v1/portfolios/{pid}").status_code == 403
    _as("viewer", seed)
    assert client.delete(f"/api/v1/portfolios/{pid}").status_code == 403
    _as("stranger", seed)
    assert client.delete(f"/api/v1/portfolios/{pid}").status_code == 403
    # Owner delete succeeds and the portfolio is really gone.
    _as("owner", seed)
    assert client.delete(f"/api/v1/portfolios/{pid}").status_code == 204
    assert client.get(f"/api/v1/portfolios/{pid}").status_code == 404


def test_editor_cannot_manage_shares(seed):
    """EDIT must not escalate: all share-management endpoints are owner-only."""
    pid = seed["portfolio"]
    _as("owner", seed)
    shares = client.get(f"/api/v1/portfolios/{pid}/shares")
    assert shares.status_code == 200, shares.text
    share_id = shares.json()[0]["id"]
    _as("editor", seed)
    assert client.post(
        f"/api/v1/portfolios/{pid}/share",
        json={"email": "stranger@example.com", "permission": "edit"},
    ).status_code == 403
    assert client.get(f"/api/v1/portfolios/{pid}/shares").status_code == 403
    assert client.delete(f"/api/v1/portfolios/{pid}/shares/{share_id}").status_code == 403
    _as("viewer", seed)
    assert client.post(
        f"/api/v1/portfolios/{pid}/share",
        json={"email": "stranger@example.com", "permission": "view"},
    ).status_code == 403


def test_owner_share_update_changes_permission(seed):
    """Re-sharing an existing recipient updates (not duplicates) permission."""
    pid = seed["portfolio"]
    _as("owner", seed)
    resp = client.post(
        f"/api/v1/portfolios/{pid}/share",
        json={"email": "viewer@example.com", "permission": "edit"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["permission"] == "edit"
    # Recipient now actually holds edit access end-to-end.
    _as("viewer", seed)
    body = client.get(f"/api/v1/portfolios/{pid}").json()
    assert body["permission"] == "edit"
    add = client.post(
        f"/api/v1/portfolios/{pid}/holdings",
        json={"symbol": "TSLA", "quantity": "3", "avg_cost": "200.00"},
    )
    assert add.status_code == 201, add.text
