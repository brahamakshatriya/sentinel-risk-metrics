from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from contextlib import contextmanager
import os
from dotenv import load_dotenv

load_dotenv()

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_DB_PATH = os.path.join(PROJECT_ROOT, "riskmetrics.db")
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH}")


def pool_options(database_url: str | None = None) -> dict:
    """Explicit, env-configurable pool envelope (S3).

    SQLite keeps driver defaults (pool args are invalid there). Postgres
    gets a bounded QueuePool: base + overflow cap total connections,
    pool_timeout fails cleanly instead of queueing forever, recycle drops
    stale connections, pre_ping preserves health-check behavior.
    """
    from app.security import resource_limits as limits

    url = database_url if database_url is not None else DATABASE_URL
    if url.startswith("sqlite"):
        return {}
    return {
        "pool_size": int(limits.DB_POOL_SIZE),
        "max_overflow": int(limits.DB_MAX_OVERFLOW),
        "pool_timeout": float(limits.DB_POOL_TIMEOUT_SECONDS),
        "pool_recycle": int(limits.DB_POOL_RECYCLE_SECONDS),
        "pool_pre_ping": bool(limits.DB_POOL_PRE_PING),
    }


def connect_args_for(database_url: str | None = None) -> dict:
    """Driver connect args per backend (S3).

    - sqlite: thread-safety flag (existing behavior preserved).
    - postgres: statement_timeout ONLY when explicitly enabled
      (S3_DB_STATEMENT_TIMEOUT_MS > 0). Default 0 = disabled: a global
      10-30s cap is unsafe without per-operation SET LOCAL because the S1
      ingestion envelope (~25k symbol-days / ~62k rows per txn) and
      alembic migrations can legitimately exceed it on free-tier Neon.
    """
    from app.security import resource_limits as limits

    url = database_url if database_url is not None else DATABASE_URL
    if url.startswith("sqlite"):
        return {"check_same_thread": False}
    args: dict = {}
    stmt_ms = int(limits.DB_STATEMENT_TIMEOUT_MS)
    if stmt_ms > 0:
        args["options"] = f"-c statement_timeout={stmt_ms}"
    return args


def build_engine(database_url: str | None = None):
    """Construct the SQLAlchemy engine with the S3 pool envelope."""
    url = database_url if database_url is not None else DATABASE_URL
    return create_engine(
        url,
        connect_args=connect_args_for(url),
        **pool_options(url),
    )


engine = build_engine()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def get_db_session() -> Session:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db():
    from app.models import Base
    Base.metadata.create_all(bind=engine)
