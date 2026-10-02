"""Machine-readable resource failure contract (Phase S1).

Validation      -> 422 (FastAPI default shape, untouched)
Resource budget -> 413 {"error": "compute_budget_exceeded" | "ingestion_budget_exceeded", ...}
Rate limit      -> 429 {"error": "rate_limited", "retry_after": N}
Capacity busy   -> 429 {"error": "compute_busy" | "ingestion_busy", "retry_after": N}

Never include SQL text, stack traces, connection strings, file paths,
provider exception dumps, JWTs, or Authorization headers.
"""


class RateLimitedError(Exception):
    def __init__(self, retry_after: int = 60, endpoint_class: str = ""):
        super().__init__("rate_limited")
        self.retry_after = max(1, int(retry_after))
        self.endpoint_class = endpoint_class


class ComputeBusyError(Exception):
    def __init__(self, retry_after: int = 5, operation: str = "monte_carlo"):
        super().__init__("compute_busy")
        self.retry_after = max(1, int(retry_after))
        self.operation = operation


class IngestionBusyError(Exception):
    def __init__(self, retry_after: int = 5):
        super().__init__("ingestion_busy")
        self.retry_after = max(1, int(retry_after))


class BudgetExceededError(Exception):
    """413 admission rejection raised BEFORE any expensive work."""

    def __init__(self, error: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.error = error
        self.message = message
        self.details = details or {}


class QuotaExceededError(Exception):
    """429 persistent business-quota rejection (S3). Distinct from the
    process-local S1 sliding-window rate limit: this quota survives
    process restarts via the database."""

    def __init__(self, retry_after: int = 3600, used: int = 0,
                 quota: int = 0, requested: int = 0):
        super().__init__("business_quota_exceeded")
        self.retry_after = max(1, int(retry_after))
        self.used = used
        self.quota = quota
        self.requested = requested
