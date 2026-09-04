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
