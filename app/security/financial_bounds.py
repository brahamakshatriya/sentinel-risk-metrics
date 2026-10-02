"""Phase S2 — centralized financial/input bounds.

Initial production-safe ceilings (env-overridable, documented estimates):

  MAX_HOLDINGS_PER_PORTFOLIO = 100   (count cap, enforced at route level)
  MAX_QUANTITY               = 1e9    (per-holding share quantity)
  MAX_AVG_COST               = 1e7    (per-share cost basis)

Rules: reject NaN/Infinity/non-finite; never silently clamp; validation
errors (422), never silent modification. Existing semantics preserved:
quantity stays strictly positive, avg_cost stays non-negative, zero
avg_cost remains valid. Risk formulas and DB schema are untouched.
"""

import math
from decimal import Decimal, InvalidOperation

from app.security import resource_limits as limits

MAX_HOLDINGS_PER_PORTFOLIO: int = int(limits.MAX_HOLDINGS_PER_PORTFOLIO)
MAX_QUANTITY: Decimal = Decimal(str(limits.MAX_QUANTITY))
MAX_AVG_COST: Decimal = Decimal(str(limits.MAX_AVG_COST))


def _to_decimal(value) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool):
        raise ValueError("must be a number")
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            raise ValueError("must be a finite number")
        return Decimal(str(value))
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, str):
        text = value.strip().lower()
        if text in ("nan", "+nan", "-nan", "inf", "+inf", "-inf",
                    "infinity", "+infinity", "-infinity"):
            raise ValueError("must be a finite number")
        try:
            return Decimal(value)
        except (InvalidOperation, ValueError, ArithmeticError):
            raise ValueError("must be a number")
    raise ValueError("must be a number")


def check_quantity(value) -> Decimal:
    """Strictly positive, finite, bounded share quantity."""
    d = _to_decimal(value)
    if d.is_nan() or not d.is_finite():
        raise ValueError("quantity must be a finite number")
    if d <= 0:
        raise ValueError("quantity must be greater than 0")
    if d > MAX_QUANTITY:
        raise ValueError(f"quantity must not exceed {MAX_QUANTITY}")
    return d


def check_avg_cost(value) -> Decimal:
    """Non-negative, finite, bounded per-share cost (zero stays valid)."""
    d = _to_decimal(value)
    if d.is_nan() or not d.is_finite():
        raise ValueError("avg_cost must be a finite number")
    if d < 0:
        raise ValueError("avg_cost must be non-negative")
    if d > MAX_AVG_COST:
        raise ValueError(f"avg_cost must not exceed {MAX_AVG_COST}")
    return d
