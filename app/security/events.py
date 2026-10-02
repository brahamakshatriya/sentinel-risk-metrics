"""Phase S3 — lightweight security-event observability (NOT a SIEM).

security_event(): single structured log line per important event with safe
  metadata only (type, timestamp, user/portfolio ids, endpoint/class,
  status/reason). NEVER pass secrets, tokens, bodies, SQL, or payloads —
  forbidden keys are dropped defensively.

AbuseTracker: process-local counters for low-cost abuse signals
  (repeated 429/403/413, quota/compute/upstream/pool signals). LOG-ONLY:
  users are never blocked on heuristics. Storage is isolated in this class
  so a future metrics exporter can replace it without touching call sites.
"""

import logging
import threading
import time
from collections import deque
from datetime import datetime, timezone

logger = logging.getLogger("sentinel.security")

# Defensive denylist: dropped from event fields even if a caller passes them.
_FORBIDDEN_KEYS = frozenset({
    "password", "passwd", "pwd", "token", "access_token", "refresh_token",
    "api_key", "apikey", "secret", "clerk_secret", "authorization",
    "bearer", "jwt", "credentials", "db_url", "database_url",
    "connection_string", "conn_str", "body", "request_body", "sql",
    "query", "financial", "payload",
})


def _sanitize(fields: dict) -> dict:
    return {k: v for k, v in fields.items()
            if k.lower() not in _FORBIDDEN_KEYS and not k.startswith("_")}


def security_event(event_type: str, **fields) -> None:
    """Emit one structured security-event line. Safe metadata only."""
    safe = _sanitize(fields)
    parts = " ".join(f"{k}={v}" for k, v in sorted(safe.items()))
    logger.warning("security_event type=%s ts=%s %s",
                   event_type,
                   datetime.now(timezone.utc).isoformat(),
                   parts)


class AbuseTracker:
    """Process-local sliding-window signal counter. Log-only by design."""

    def __init__(self):
        self._lock = threading.Lock()
        self._buckets: dict[str, deque] = {}
        self._last_alert: dict[str, float] = {}

    def note(self, signal: str, identity: str, threshold: int,
             window_seconds: int) -> bool:
        """Record one occurrence. Returns True once per window when the
        threshold is crossed (subsequent crossings re-log after the window)."""
        now = time.monotonic()
        key = f"{signal}:{identity}"
        with self._lock:
            bucket = self._buckets.setdefault(key, deque())
            while bucket and bucket[0] <= now - window_seconds:
                bucket.popleft()
            bucket.append(now)
            crossed = len(bucket) >= threshold
            last = self._last_alert.get(key, 0.0)
            if crossed and now - last >= window_seconds:
                self._last_alert[key] = now
                return True
            return False

    def clear(self) -> None:
        with self._lock:
            self._buckets.clear()
            self._last_alert.clear()


_tracker = AbuseTracker()


def get_abuse_tracker() -> AbuseTracker:
    return _tracker


def reset_abuse_tracker() -> None:
    _tracker.clear()


def note_abuse(signal: str, identity: str, threshold: int,
               window_seconds: int, **fields) -> bool:
    """Record a signal; on windowed threshold-crossing emit abuse_signal."""
    if get_abuse_tracker().note(signal, identity, threshold, window_seconds):
        security_event("abuse_signal", signal=signal, identity=identity,
                       threshold=threshold, window_seconds=window_seconds,
                       **fields)
        return True
    return False
