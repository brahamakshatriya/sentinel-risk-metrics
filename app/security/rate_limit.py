"""Central in-memory rate limiter (Phase S1).

Deployment assumption: SINGLE Render worker / free-tier environment.

  In-memory limits are process-local and are NOT sufficient for
  multi-instance deployment.

The storage backend is isolated behind `RateLimiterStore` so a future
distributed limiter (Redis/token-bucket) can replace it without
rewriting routes: only `InMemoryRateLimiter` / `get_global_limiter`
need swapping; `enforce_rate_limit` and bucket-key builders stay stable.

Bucket isolation: every (identity + endpoint class) pair gets its own
bucket. Classes: ANON | AUTH_STANDARD | COMPUTE | INGEST.
One class can never consume another class's budget.
"""

import threading
import time
from collections import deque

from app.security import resource_limits as limits
from app.security.errors import RateLimitedError

ANON = "ANON"
AUTH_STANDARD = "AUTH_STANDARD"
COMPUTE = "COMPUTE"
INGEST = "INGEST"
AUTH_READ = "AUTH_READ"
AUTH_MUTATION = "AUTH_MUTATION"
SHARE_MUTATION = "SHARE_MUTATION"


class InMemoryRateLimiter:
    """Thread-safe sliding-window limiter. Process-local only."""

    def __init__(self):
        self._lock = threading.Lock()
        self._buckets: dict[str, deque] = {}

    def check_and_consume(self, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        now = time.monotonic()
        with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                bucket = deque()
                self._buckets[key] = bucket
            while bucket and bucket[0] <= now - window_seconds:
                bucket.popleft()
            if len(bucket) < limit:
                bucket.append(now)
                return True, 0
            retry_after = int(bucket[0] + window_seconds - now) + 1
            return False, max(1, retry_after)

    def clear(self) -> None:
        with self._lock:
            self._buckets.clear()


_global_limiter = InMemoryRateLimiter()


def get_global_limiter() -> InMemoryRateLimiter:
    return _global_limiter


def reset_global_limiter() -> None:
    _global_limiter.clear()


def anon_key(ip: str, endpoint_class: str) -> str:
    return f"{endpoint_class}:ip:{ip or 'unknown'}"


def user_key(user_id: int, endpoint_class: str) -> str:
    return f"{endpoint_class}:user:{user_id}"


def compute_key(user_id: int, portfolio_id: int | None, endpoint_class: str = COMPUTE) -> str:
    return f"{endpoint_class}:user:{user_id}:portfolio:{portfolio_id}"


def enforce_rate_limit(endpoint_class: str, identity: str,
                       limiter: InMemoryRateLimiter | None = None) -> None:
    """Raise RateLimitedError(429) when the isolated bucket is exhausted."""
    cfg = limits.RATE_CLASSES.get(endpoint_class)
    if cfg is None:
        raise ValueError(f"Unknown rate class: {endpoint_class}")
    lim = limiter or get_global_limiter()
    allowed, retry_after = lim.check_and_consume(
        f"{endpoint_class}:{identity}", cfg.limit, cfg.window_seconds
    )
    if not allowed:
        raise RateLimitedError(retry_after=retry_after, endpoint_class=endpoint_class)


def client_ip(request) -> str:
    """Best-effort client IP: X-Forwarded-For (first) else request.client."""
    try:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        if request.client is not None:
            return request.client.host
    except Exception:
        pass
    return "unknown"
