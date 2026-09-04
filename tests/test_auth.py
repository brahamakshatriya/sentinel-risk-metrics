import base64
import sys
import time
sys.path.insert(0, r"C:\Users\Dhananjay\Downloads\Dhruv's Pvt docs\RiskMetrics")

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt

from app import auth as authmod
from app.models import Base, User

ISSUER = "https://test-clerk.accounts.dev"
KID = "test-key-1"


def _b64url_uint(n: int) -> str:
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


@pytest.fixture()
def rsa_keys():
    """Generate an RSA pair; expose private PEM + public JWK (Clerk-style)."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key()
    numbers = public_key.public_numbers()
    public_jwk = {
        "kty": "RSA",
        "use": "sig",
        "kid": KID,
        "alg": "RS256",
        "n": _b64url_uint(numbers.n),
        "e": _b64url_uint(numbers.e),
    }
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    return private_pem, public_jwk


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture(autouse=True)
def _issuer(monkeypatch):
    monkeypatch.setattr(authmod, "CLERK_ISSUER", ISSUER)
    monkeypatch.setattr(authmod, "CLERK_SECRET_KEY", "sk_test_dummy")


def _token(private_pem, claims, headers=None):
    return jwt.encode(claims, private_pem, algorithm="RS256", headers=headers or {"kid": KID})


def _jwks(public_jwk):
    return {"keys": [public_jwk]}


def test_get_signing_key_constructs_verifiable_rsa_key(rsa_keys):
    """get_signing_key() must return a key jwt.decode accepts for RS256."""
    private_pem, public_jwk = rsa_keys
    now = int(time.time())
    token = _token(private_pem, {"iss": ISSUER, "sub": "user_1", "iat": now, "exp": now + 600})
    with patch.object(authmod, "get_jwks", return_value=_jwks(public_jwk)):
        key = authmod.get_signing_key(token)
        payload = jwt.decode(
            token, key, algorithms=["RS256"], issuer=ISSUER, options={"verify_aud": False}
        )
    assert payload["sub"] == "user_1"


def test_verify_clerk_token_accepts_valid_token(rsa_keys):
    private_pem, public_jwk = rsa_keys
    now = int(time.time())
    token = _token(private_pem, {"iss": ISSUER, "sub": "user_1", "iat": now, "exp": now + 600})
    with patch.object(authmod, "get_jwks", return_value=_jwks(public_jwk)):
        payload = authmod.verify_clerk_token(token)
    assert payload["sub"] == "user_1"


def test_verify_rejects_wrong_issuer(rsa_keys):
    """Issuer validation must remain enabled."""
    private_pem, public_jwk = rsa_keys
    now = int(time.time())
    token = _token(private_pem, {"iss": "https://evil.example.com", "sub": "user_1",
                                 "iat": now, "exp": now + 600})
    with patch.object(authmod, "get_jwks", return_value=_jwks(public_jwk)):
        with pytest.raises(HTTPException) as exc:
            authmod.verify_clerk_token(token)
    assert exc.value.status_code == 401


def test_verify_rejects_wrong_algorithm(rsa_keys):
    """Only RS256 accepted — an HS256 token must be rejected."""
    _, public_jwk = rsa_keys
    now = int(time.time())
    hs_token = jwt.encode({"iss": ISSUER, "sub": "user_1", "iat": now, "exp": now + 600},
                          "not-a-real-secret", algorithm="HS256", headers={"kid": KID})
    with patch.object(authmod, "get_jwks", return_value=_jwks(public_jwk)):
        with pytest.raises(HTTPException) as exc:
            authmod.verify_clerk_token(hs_token)
    assert exc.value.status_code == 401


def test_verify_rejects_tampered_and_expired(rsa_keys):
    private_pem, public_jwk = rsa_keys
    now = int(time.time())
    token = _token(private_pem, {"iss": ISSUER, "sub": "user_1", "iat": now - 1200,
                                 "exp": now + 600})
    tampered = token[:-2] + ("AA" if not token.endswith("AA") else "BB")
    with patch.object(authmod, "get_jwks", return_value=_jwks(public_jwk)):
        with pytest.raises(HTTPException):
            authmod.verify_clerk_token(tampered)
        expired = _token(private_pem, {"iss": ISSUER, "sub": "user_1",
                                       "iat": now - 1200, "exp": now - 600})
        with pytest.raises(HTTPException):
            authmod.verify_clerk_token(expired)


def _creds():
    c = MagicMock()
    c.credentials = "fake.jwt.token"
    return c


def test_get_current_user_sub_only_succeeds(rsa_keys, db):
    """CASE A: sub-only JWT authenticates and creates the local user."""
    import asyncio
    fake_resp = MagicMock()
    fake_resp.json.return_value = {
        "primary_email_address_id": "id1",
        "email_addresses": [{"id": "id1", "email_address": "A@Example.com",
                             "verification": {"status": "verified"}}],
    }
    fake_resp.raise_for_status.return_value = None
    with patch.object(authmod, "verify_clerk_token", return_value={"sub": "user_A"}):
        with patch.object(authmod.httpx, "get", return_value=fake_resp):
            user = asyncio.run(authmod.get_current_user(_creds(), db))
    assert isinstance(user, User)
    assert user.clerk_user_id == "user_A"
    assert user.email == "a@example.com"


def test_get_current_user_requires_credentials(db):
    """CASE C: missing credentials -> 401 Authentication required."""
    import asyncio
    with pytest.raises(HTTPException) as exc:
        asyncio.run(authmod.get_current_user(None, db))
    assert exc.value.status_code == 401
    assert exc.value.detail == "Authentication required"
