"""Bounded concurrency gates (Phase S1).

Goals: bounded admission + bounded execution + bounded memory.

- Non-blocking acquire only. NEVER an unbounded in-process queue.
- No Redis / Celery / RabbitMQ; no async worker conversion.
- Single-worker assumption: threading.Semaphore is sufficient; for
  multi-instance deployment move to a distributed semaphore.

MC timeout note: numpy GBM simulation cannot be safely cancelled
mid-flight. MC_TIMEOUT_SECONDS is therefore a soft observability budget
(elapsed measurement + warning log). True hard cancellation is DEFERRED
to a future worker-based architecture. We never fake cancellation.
"""

import threading
from contextlib import contextmanager


class BoundedGate:
    """Global semaphore + per-key semaphores, non-blocking."""

    def __init__(self, global_slots: int, per_key_slots: int):
        self._global = threading.Semaphore(max(1, global_slots))
        self._per_key_slots = max(1, per_key_slots)
        self._lock = threading.Lock()
        self._key_semaphores: dict[str, threading.Semaphore] = {}

    def _key_sem(self, key: str) -> threading.Semaphore:
        with self._lock:
            sem = self._key_semaphores.get(key)
            if sem is None:
                sem = threading.Semaphore(self._per_key_slots)
                self._key_semaphores[key] = sem
            return sem

    def try_acquire(self, key: str = "default") -> bool:
        """Non-blocking: acquire BOTH global and per-key slot or neither."""
        key_sem = self._key_sem(key)
        if not key_sem.acquire(blocking=False):
            return False
        if not self._global.acquire(blocking=False):
            key_sem.release()
            return False
        return True

    def release(self, key: str = "default") -> None:
        try:
            self._key_sem(key).release()
        finally:
            self._global.release()

    @contextmanager
    def hold(self, key: str = "default"):
        acquired = self.try_acquire(key)
        if not acquired:
            raise RuntimeError("gate busy")
        try:
            yield
        finally:
            self.release(key)


def _make_mc_gate():
    from app.security import resource_limits as limits

    return BoundedGate(
        global_slots=limits.MC_GLOBAL_CONCURRENCY,
        per_key_slots=limits.MC_USER_CONCURRENCY,
    )


def _make_ingest_gate():
    from app.security import resource_limits as limits

    return BoundedGate(
        global_slots=limits.INGEST_GLOBAL_CONCURRENCY,
        per_key_slots=limits.INGEST_USER_CONCURRENCY,
    )


mc_gate = _make_mc_gate()
ingest_gate = _make_ingest_gate()
