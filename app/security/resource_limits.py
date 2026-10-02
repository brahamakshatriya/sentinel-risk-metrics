"""SENTINEL Phase S1 — Availability Protection.

Centralized, env-overridable resource policy with safe defaults.

These values are INITIAL PRODUCTION-SAFE ESTIMATES for a single
Render worker / free-tier environment and MUST be tuned from telemetry
(429/413 rates, p95 latency, worker RSS, Yahoo 429s, pool exhaustion).

No authentication, authorization, risk mathematics, portfolio ownership,
tenant isolation, or financial semantics live here — only budgets.
"""

import os
from dataclasses import dataclass


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _float_env(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


# --- Monte Carlo -----------------------------------------------------------
# RAM model (admission control only, never allocates):
#   RAM ~= 3 x simulations x (horizon + 1) x assets x 8 bytes
# Budget 8M cells  => worst transient ~3 x 8M x 8B ~= 192 MB,
# safe headroom on a 512 MB worker for 1 request + framework overhead.
MC_CELLS_BUDGET: int = _int_env("S1_MC_CELLS_BUDGET", 8_000_000)
MC_GLOBAL_CONCURRENCY: int = _int_env("S1_MC_GLOBAL_CONCURRENCY", 2)
MC_USER_CONCURRENCY: int = _int_env("S1_MC_USER_CONCURRENCY", 1)
# NOTE: numpy GBM simulation is synchronous and non-interruptible.
# MC_TIMEOUT_SECONDS is a soft observability budget (log-only). True hard
# cancellation requires a worker-based architecture (DEFERRED, see gates.py).
MC_TIMEOUT_SECONDS: float = _float_env("S1_MC_TIMEOUT_SECONDS", 60.0)
MC_MAX_RESPONSE_BYTES: int = _int_env("S1_MC_MAX_RESPONSE_BYTES", 2_000_000)
MC_MAX_SAMPLE_PATHS: int = _int_env("S1_MC_MAX_SAMPLE_PATHS", 50)

# --- Ingestion -------------------------------------------------------------
INGEST_MAX_SYMBOLS: int = _int_env("S1_INGEST_MAX_SYMBOLS", 50)
INGEST_MAX_SYMBOL_DAYS: int = _int_env("S1_INGEST_MAX_SYMBOL_DAYS", 25_000)
INGEST_MAX_DATE_RANGE_DAYS: int = _int_env("S1_INGEST_MAX_DATE_RANGE_DAYS", 1825)
INGEST_GLOBAL_CONCURRENCY: int = _int_env("S1_INGEST_GLOBAL_CONCURRENCY", 4)
INGEST_USER_CONCURRENCY: int = _int_env("S1_INGEST_USER_CONCURRENCY", 2)
INGEST_TIMEOUT_SECONDS: float = _float_env("S1_INGEST_TIMEOUT_SECONDS", 30.0)

# --- Rate limiting (requests per window, per isolated bucket) ---------------
RATE_ANON_LIMIT: int = _int_env("S1_RATE_ANON_LIMIT", 60)
RATE_ANON_WINDOW_SECONDS: int = _int_env("S1_RATE_ANON_WINDOW", 60)
RATE_AUTH_LIMIT: int = _int_env("S1_RATE_AUTH_LIMIT", 300)
RATE_AUTH_WINDOW_SECONDS: int = _int_env("S1_RATE_AUTH_WINDOW", 60)
RATE_COMPUTE_LIMIT: int = _int_env("S1_RATE_COMPUTE_LIMIT", 20)
RATE_COMPUTE_WINDOW_SECONDS: int = _int_env("S1_RATE_COMPUTE_WINDOW", 60)
RATE_INGEST_LIMIT: int = _int_env("S1_RATE_INGEST_LIMIT", 30)
RATE_INGEST_WINDOW_SECONDS: int = _int_env("S1_RATE_INGEST_WINDOW", 60)


@dataclass(frozen=True)
class RateClassConfig:
    limit: int
    window_seconds: int


RATE_CLASSES: dict = {
    "ANON": RateClassConfig(RATE_ANON_LIMIT, RATE_ANON_WINDOW_SECONDS),
    "AUTH_STANDARD": RateClassConfig(RATE_AUTH_LIMIT, RATE_AUTH_WINDOW_SECONDS),
    "COMPUTE": RateClassConfig(RATE_COMPUTE_LIMIT, RATE_COMPUTE_WINDOW_SECONDS),
    "INGEST": RateClassConfig(RATE_INGEST_LIMIT, RATE_INGEST_WINDOW_SECONDS),
}


# --- Pure admission-control helpers (no I/O, no allocation) ----------------

def mc_cells(num_simulations: int, horizon_days: int, asset_count: int) -> int:
    """Admission-control cell count. Must be computed BEFORE simulation."""
    return int(num_simulations) * (int(horizon_days) + 1) * int(asset_count)


def estimate_mc_ram_bytes(num_simulations: int, horizon_days: int, asset_count: int) -> int:
    """RAM model: 3 x cells x 8 bytes (portfolio + asset + shock tensors)."""
    return 3 * mc_cells(num_simulations, horizon_days, asset_count) * 8


def ingestion_span_days(start, end) -> int:
    """Inclusive calendar-day span. Deterministic; `date` objects carry no tz."""
    return (end - start).days + 1


def ingestion_symbol_days(num_symbols: int, start, end) -> int:
    return int(num_symbols) * ingestion_span_days(start, end)


# --- Phase S2: upstream resilience -------------------------------------------
# Initial production-safe estimates; tune from telemetry (upstream p95,
# timeout/retry counters, JWKS refresh rate). Retries are hard-capped at 1
# in code regardless of env (see upstream.py).
YAHOO_TIMEOUT_SECONDS: float = _float_env("S2_YAHOO_TIMEOUT_SECONDS", 12.0)
YAHOO_MAX_RETRIES: int = _int_env("S2_YAHOO_MAX_RETRIES", 1)
FRED_TIMEOUT_SECONDS: float = _float_env("S2_FRED_TIMEOUT_SECONDS", 10.0)
FRED_MAX_RETRIES: int = _int_env("S2_FRED_MAX_RETRIES", 1)
JWKS_TIMEOUT_SECONDS: float = _float_env("S2_JWKS_TIMEOUT_SECONDS", 10.0)
JWKS_TTL_SECONDS: float = _float_env("S2_JWKS_TTL_SECONDS", 600.0)

# --- Phase S2: request body + financial bounds --------------------------------
MAX_BODY_BYTES: int = _int_env("S2_MAX_BODY_BYTES", 1_048_576)
MAX_HOLDINGS_PER_PORTFOLIO: int = _int_env("S2_MAX_HOLDINGS", 100)
# Finite string defaults avoid float-precision drift in Decimal() conversion.
MAX_QUANTITY: str = os.getenv("S2_MAX_QUANTITY", "1000000000")
MAX_AVG_COST: str = os.getenv("S2_MAX_AVG_COST", "10000000")


# --- Phase S3: database integrity + abuse controls ---------------------------
# Small-deployment envelope (single Render worker + Neon free tier):
# 5 base + 5 overflow bounds PG connections at 10; pool_timeout fails
# cleanly instead of queueing forever; recycle drops stale connections;
# pre_ping preserves the existing health-check behavior.
DB_POOL_SIZE: int = _int_env("S3_DB_POOL_SIZE", 5)
DB_MAX_OVERFLOW: int = _int_env("S3_DB_MAX_OVERFLOW", 5)
DB_POOL_TIMEOUT_SECONDS: float = _float_env("S3_DB_POOL_TIMEOUT", 10.0)
DB_POOL_RECYCLE_SECONDS: int = _int_env("S3_DB_POOL_RECYCLE", 300)
DB_POOL_PRE_PING: bool = os.getenv("S3_DB_POOL_PRE_PING", "true").lower() == "true"
# Statement timeout: MECHANISM implemented, activation DEFERRED by default.
# A global 10-30s cap is unsafe without per-operation SET LOCAL because the
# S1 ingestion envelope (up to ~25k symbol-days / ~62k rows per txn) and
# alembic migrations can legitimately exceed it on free-tier Neon.
# Enable only after telemetry review: S3_DB_STATEMENT_TIMEOUT_MS > 0.
DB_STATEMENT_TIMEOUT_MS: int = _int_env("S3_DB_STATEMENT_TIMEOUT_MS", 0)

# Persistent business quota: per-user UTC-day ingestion symbol-days.
# Coarse-grained; complements (never replaces) the S1 sliding-window limit.
DAILY_INGEST_SYMBOL_DAYS: int = _int_env("S3_DAILY_INGEST_SYMBOL_DAYS", 100_000)

# Resource-count ceilings (new rows / grants rejected before expensive work).
MAX_PORTFOLIOS_PER_USER: int = _int_env("S3_MAX_PORTFOLIOS", 50)
MAX_SHARES_PER_PORTFOLIO: int = _int_env("S3_MAX_SHARES_PER_PORTFOLIO", 50)

# CRUD rate classes (per-user isolated buckets; generous dashboard-safe).
RATE_AUTH_READ_LIMIT: int = _int_env("S3_RATE_AUTH_READ_LIMIT", 300)
RATE_AUTH_READ_WINDOW_SECONDS: int = _int_env("S3_RATE_AUTH_READ_WINDOW", 60)
RATE_AUTH_MUTATION_LIMIT: int = _int_env("S3_RATE_AUTH_MUTATION_LIMIT", 200)
RATE_AUTH_MUTATION_WINDOW_SECONDS: int = _int_env("S3_RATE_AUTH_MUTATION_WINDOW", 60)
RATE_SHARE_MUTATION_LIMIT: int = _int_env("S3_RATE_SHARE_MUTATION_LIMIT", 60)
RATE_SHARE_MUTATION_WINDOW_SECONDS: int = _int_env("S3_RATE_SHARE_MUTATION_WINDOW", 60)

RATE_CLASSES.update({
    "AUTH_READ": RateClassConfig(RATE_AUTH_READ_LIMIT, RATE_AUTH_READ_WINDOW_SECONDS),
    "AUTH_MUTATION": RateClassConfig(RATE_AUTH_MUTATION_LIMIT, RATE_AUTH_MUTATION_WINDOW_SECONDS),
    "SHARE_MUTATION": RateClassConfig(RATE_SHARE_MUTATION_LIMIT, RATE_SHARE_MUTATION_WINDOW_SECONDS),
})

# Abuse-signal thresholds (log-only, never block): N events per window.
ABUSE_WINDOW_SECONDS: int = _int_env("S3_ABUSE_WINDOW", 300)
ABUSE_REPEATED_429: int = _int_env("S3_ABUSE_REPEATED_429", 10)
ABUSE_REPEATED_403: int = _int_env("S3_ABUSE_REPEATED_403", 10)
ABUSE_REPEATED_413: int = _int_env("S3_ABUSE_REPEATED_413", 10)
