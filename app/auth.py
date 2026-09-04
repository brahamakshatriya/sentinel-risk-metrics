import os
import logging
from typing import Optional
from functools import lru_cache

import httpx
from jose import jwt, JWTError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models import User

logger = logging.getLogger(__name__)

CLERK_JWKS_URL = os.getenv("CLERK_JWKS_URL")
CLERK_ISSUER = os.getenv("CLERK_ISSUER")
CLERK_SECRET_KEY = os.getenv("CLERK_SECRET_KEY")

if not CLERK_JWKS_URL or not CLERK_ISSUER:
    logger.warning("CLERK_JWKS_URL or CLERK_ISSUER not set - authentication will not work")

security = HTTPBearer(auto_error=False)


@lru_cache(maxsize=1)
def get_jwks() -> dict:
    """Fetch and cache Clerk's JWKS (JSON Web Key Set)."""
    if not CLERK_JWKS_URL:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Clerk JWKS URL not configured"
        )
    try:
        response = httpx.get(CLERK_JWKS_URL, timeout=10.0)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        logger.error(f"Failed to fetch JWKS: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to fetch authentication keys"
        )


def get_signing_key(token: str) -> str:
    """Extract the signing key from JWKS based on token's kid header."""
    jwks = get_jwks()
    unverified_header = jwt.get_unverified_header(token)
    kid = unverified_header.get("kid")
    
    if not kid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing key ID"
        )
    
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return jwt.algorithms.RSAAlgorithm.from_jwk(key)
    
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Unable to find matching signing key"
    )


def verify_clerk_token(token: str) -> dict:
    """Verify a Clerk-issued JWT token and return its claims."""
    if not CLERK_ISSUER:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Clerk issuer not configured"
        )
    
    try:
        key = get_signing_key(token)
        payload = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            issuer=CLERK_ISSUER,
            options={"verify_aud": False},  # Clerk tokens don't always have aud
        )
        return payload
    except JWTError as e:
        logger.warning(f"JWT verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Token verification error: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token verification failed"
        )


def _resolve_email(clerk_user_id: str, payload: dict) -> Optional[str]:
    """
    Resolve the user's email address without ever logging secrets/tokens.

    Order: JWT `email` claim (custom session claims) -> Clerk Backend API
    lookup via CLERK_SECRET_KEY -> None (caller falls back to placeholder).
    """
    # 1. Custom session claim, if the Clerk dashboard adds one.
    for key in ("email", "primary_email", "email_address"):
        value = payload.get(key)
        if isinstance(value, str) and "@" in value:
            return value.lower()

    # 2. Clerk Backend API lookup. Requires CLERK_SECRET_KEY on the server.
    if not CLERK_SECRET_KEY:
        logger.warning("CLERK_SECRET_KEY not set - cannot look up user email via Clerk API")
        return None
    try:
        response = httpx.get(
            f"https://api.clerk.com/v1/users/{clerk_user_id}",
            headers={"Authorization": f"Bearer {CLERK_SECRET_KEY}"},
            timeout=10.0,
        )
        response.raise_for_status()
        data = response.json()
        for addr in data.get("email_addresses", []) or []:
            if addr.get("id") == data.get("primary_email_address_id"):
                email = addr.get("email_address")
                if email:
                    return email.lower()
        # Fallback: first verified address, then first address at all.
        for addr in data.get("email_addresses", []) or []:
            if addr.get("verification", {}).get("status") == "verified" and addr.get("email_address"):
                return addr["email_address"].lower()
        addresses = data.get("email_addresses", []) or []
        if addresses and addresses[0].get("email_address"):
            return addresses[0]["email_address"].lower()
    except Exception as e:
        logger.warning(f"Clerk user email lookup failed: {e}")
    return None


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """
    FastAPI dependency that verifies the Clerk JWT and returns the authenticated User.
    Creates the user record lazily if it doesn't exist yet.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    payload = verify_clerk_token(credentials.credentials)

    clerk_user_id = payload.get("sub")

    if not clerk_user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing required claim (sub)"
        )

    # Clerk's default session JWT carries `sub` but NOT `email` at the top
    # level (unless custom session claims are configured). Resolve the
    # email with: JWT claim -> Clerk Backend API -> safe placeholder.
    email = payload.get("email") or _resolve_email(clerk_user_id, payload)

    if not email:
        logger.warning("Authenticated user has no resolvable email; using placeholder")
        email = f"{clerk_user_id}@placeholder.local"

    # Lazy user creation: find or create user record
    user = db.query(User).filter(User.clerk_user_id == clerk_user_id).first()
    if not user:
        user = User(clerk_user_id=clerk_user_id, email=email)
        db.add(user)
        db.commit()
        db.refresh(user)
        logger.info("Created new user record (local id=%s)", user.id)
    elif user.email != email and "@placeholder.local" not in user.email and "@placeholder.local" not in email:
        # Keep the stored email in sync once the real address is known.
        user.email = email
        db.commit()
        db.refresh(user)

    return user


async def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> Optional[User]:
    """
    Optional authentication - returns User if valid token provided, None otherwise.
    Useful for endpoints that work differently for authenticated vs anonymous users.
    """
    if not credentials:
        return None
    
    try:
        return await get_current_user(credentials, db)
    except HTTPException:
        return None