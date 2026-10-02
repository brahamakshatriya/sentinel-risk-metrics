"""Phase S3 — persistent per-user daily ingestion quota.

BUSINESS QUOTA, not a rate-limit replacement. Both stay active:

  authentication -> authorization -> S1 rate limit -> S3 quota check
  -> S1 ingestion budget -> S1 concurrency gate -> Yahoo -> record usage

Semantics:
  - Bucket: UTC calendar day; rolls over automatically (no cleanup of
    historical rows — they form the audit trail).
  - Unit: requested symbol-days (same envelope the S1 budget admits).
  - Usage is recorded AFTER the Yahoo round-trip executes (dedup-skipped
    and pre-Yahoo-rejected requests never consume quota).
  - Check is pre-Yahoo; record is a single atomic UPDATE expression
    (no read-modify-write, so concurrent increments cannot lose updates).
    Under true concurrency two requests may both pass the check and both
    record; the S1 per-user ingest gate (2 slots) bounds that overshoot
    to <2 envelopes. Documented limitation, not silent behavior.
  - Never negative: increments are positive-only; no decrement path.
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import update

from app.security import resource_limits as limits
from app.security.errors import QuotaExceededError

logger = logging.getLogger(__name__)


def utc_today():
    return datetime.now(timezone.utc).date()


def seconds_until_utc_midnight() -> int:
    now = datetime.now(timezone.utc)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    from datetime import timedelta
    return int((midnight + timedelta(days=1) - now).total_seconds())


def quota_limit() -> int:
    return int(limits.DAILY_INGEST_SYMBOL_DAYS)


def current_usage(db, user_id: int, day=None) -> int:
    """Read today's recorded usage (0 when no row exists)."""
    from app.models import IngestionQuota
    day = day or utc_today()
    row = db.query(IngestionQuota).filter(
        IngestionQuota.user_id == user_id,
        IngestionQuota.day == day,
    ).first()
    return int(row.symbol_days) if row else 0


def check_ingest_quota(db, user_id: int, requested_symbol_days: int,
                       day=None) -> None:
    """Pre-Yahoo admission. Raises QuotaExceededError (429) on exhaustion."""
    from app.models import IngestionQuota
    day = day or utc_today()
    used = current_usage(db, user_id, day)
    quota = quota_limit()
    if used + int(requested_symbol_days) > quota:
        logger.warning(
            "quota_rejected operation=ingest user_id=%s used=%s requested=%s quota=%s",
            user_id, used, requested_symbol_days, quota,
        )
        # Delayed import avoids a hard dependency cycle (events is leaf-level,
        # but keep quota import-light for reuse in scripts).
        from app.security.events import security_event
        security_event("ingestion_quota_rejection", user_id=user_id,
                       used=used, requested=int(requested_symbol_days),
                       quota=quota)
        raise QuotaExceededError(
            retry_after=seconds_until_utc_midnight(),
            used=used, quota=quota, requested=int(requested_symbol_days),
        )


def record_ingest_usage(db, user_id: int, symbol_days: int, day=None) -> int:
    """Post-Yahoo accounting. Single atomic UPDATE; returns new total."""
    from app.models import IngestionQuota
    from datetime import datetime as _dt
    day = day or utc_today()
    amount = max(0, int(symbol_days))
    if amount == 0:
        return current_usage(db, user_id, day)
    row = db.query(IngestionQuota).filter(
        IngestionQuota.user_id == user_id,
        IngestionQuota.day == day,
    ).first()
    if row is None:
        from sqlalchemy.exc import IntegrityError
        row = IngestionQuota(user_id=user_id, day=day, symbol_days=amount,
                             updated_at=_dt.now(timezone.utc).replace(tzinfo=None))
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            # Concurrent first-use: another request inserted the row
            # (uq_quota_user_day backstop). Fall through to the atomic
            # increment path below instead of surfacing a 500.
            db.rollback()
            logger.info("quota_race duplicate day-row for user %s; incrementing", user_id)
            return record_ingest_usage(db, user_id, amount, day)
        db.refresh(row)
        return int(row.symbol_days)
    # Atomic increment: serialized by the row lock on Postgres; no
    # read-modify-write, so concurrent recorders cannot lose updates.
    db.execute(
        update(IngestionQuota)
        .where(IngestionQuota.id == row.id)
        .values(symbol_days=IngestionQuota.symbol_days + amount)
    )
    db.commit()
    return current_usage(db, user_id, day)
