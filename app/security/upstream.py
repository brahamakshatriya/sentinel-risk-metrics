"""Phase S2 — shared upstream-failure taxonomy.

A failure is TRANSIENT (exactly one retry allowed) only when it signals
a network/transport problem where an immediate single retry can succeed:

  - builtin TimeoutError / concurrent.futures.TimeoutError (our bound)
  - requests.exceptions.ConnectionError / Timeout

Everything else is NON-TRANSIENT and must NEVER be retried:

  - validation errors (bad symbol, bad range, empty provider response)
  - database errors
  - HTTP 429 rate-limit responses (back off, do not hammer)
  - authentication/authorization failures
  - malformed payloads / unexpected values

Retry budget is hard-capped at 1 in code: env overrides may lower it to 0
but can never raise it above 1 (no retry storms by misconfiguration).
"""

import logging
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Callable, TypeVar

import requests

logger = logging.getLogger(__name__)

TRANSIENT_UPSTREAM_ERRORS: tuple = (
    TimeoutError,
    requests.exceptions.ConnectionError,
    requests.exceptions.Timeout,
)

# concurrent.futures.TimeoutError is an alias of builtin TimeoutError in
# Python 3.11+ (kept explicit for clarity on older interpreters).
try:
    from concurrent.futures import TimeoutError as FuturesTimeoutError

    if FuturesTimeoutError is not TimeoutError:
        TRANSIENT_UPSTREAM_ERRORS = TRANSIENT_UPSTREAM_ERRORS + (FuturesTimeoutError,)
except ImportError:  # pragma: no cover
    pass


def is_transient_upstream(exc: BaseException) -> bool:
    """True only for network/transport failures eligible for one retry."""
    return isinstance(exc, TRANSIENT_UPSTREAM_ERRORS)


def cap_retries(configured: int) -> int:
    """Hard cap: retries may be lowered via env, never raised above 1."""
    return max(0, min(int(configured), 1))


T = TypeVar("T")

# Small shared pool for providers WITHOUT native timeout support (FRED).
# Fixed size bounds lingering threads; each entry resolves (success,
# failure, or caller-side timeout) so the pool cannot grow.
_fred_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="s2-fred")


def call_bounded(func: Callable[[], T], timeout_seconds: float) -> T:
    """Run a blocking provider call with a hard caller-side timeout.

    On timeout the caller's request fails bounded; the worker thread may
    linger until the underlying socket gives up, but pool size is fixed
    so thread count cannot grow without bound.
    """
    future: Future = _fred_executor.submit(func)
    return future.result(timeout=timeout_seconds)
