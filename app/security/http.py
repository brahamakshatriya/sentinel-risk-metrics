"""Phase S2 — HTTP-layer protections (pure ASGI, no framework coupling).

BodySizeLimitMiddleware: rejects oversized JSON request bodies early with
  413 {"error": "request_too_large", ...}. Reads at most max_bytes+1 from
  the wire; normal requests are replayed byte-identical downstream, so
  authentication, validation, and business logic are unaffected. Runs
  before routing but changes nothing for in-budget requests.

SecurityHeadersMiddleware: baseline headers on every response, including
  error responses. HSTS only on HTTPS (scope scheme or X-Forwarded-Proto);
  never on local HTTP development. CSP is deliberately NOT enforced:
  a restrictive policy risks breaking Swagger/local dev and the Vercel
  frontend; revisit with report-only telemetry first (DEFERRED).
"""

import json
import logging

from app.security import resource_limits as limits

logger = logging.getLogger(__name__)


def _json_response(status: int, payload: dict, extra_headers: list | None = None) -> list:
    body = json.dumps(payload).encode("utf-8")
    headers = [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(body)).encode("latin-1")),
    ]
    if extra_headers:
        headers.extend(extra_headers)
    return headers, body


class BodySizeLimitMiddleware:
    """Bound request-body size. Default ~1 MiB (env S2_MAX_BODY_BYTES)."""

    def __init__(self, app, max_bytes: int | None = None):
        self.app = app
        self.max_bytes = int(max_bytes if max_bytes is not None else limits.MAX_BODY_BYTES)

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        max_bytes = self.max_bytes
        try:
            headers = {k.decode("latin-1").lower(): v.decode("latin-1")
                       for k, v in scope.get("headers", [])}
            content_length = int(headers.get("content-length") or 0)
        except (ValueError, UnicodeDecodeError):
            content_length = 0

        if content_length > max_bytes:
            logger.warning(
                "request_rejected reason=oversize content_length=%s max_bytes=%s path=%s",
                content_length, max_bytes, scope.get("path"),
            )
            resp_headers, body = _json_response(413, {
                "error": "request_too_large",
                "message": f"Request body exceeds maximum {max_bytes} bytes.",
                "details": {"max_bytes": max_bytes},
            })
            await send({"type": "http.response.start", "status": 413, "headers": resp_headers})
            await send({"type": "http.response.body", "body": body})
            return

        if content_length:
            # Declared size fits; stream through untouched.
            await self.app(scope, receive, send)
            return

        # No (usable) Content-Length — e.g. chunked encoding. Buffer bounded.
        messages = []
        total = 0
        while True:
            message = await receive()
            if message.get("type") == "http.disconnect":
                await self.app(scope, receive, send)
                return
            chunk = message.get("body", b"")
            total += len(chunk)
            if total > max_bytes:
                logger.warning(
                    "request_rejected reason=oversize_chunked max_bytes=%s path=%s",
                    max_bytes, scope.get("path"),
                )
                resp_headers, body = _json_response(413, {
                    "error": "request_too_large",
                    "message": f"Request body exceeds maximum {max_bytes} bytes.",
                    "details": {"max_bytes": max_bytes},
                })
                await send({"type": "http.response.start", "status": 413, "headers": resp_headers})
                await send({"type": "http.response.body", "body": body})
                return
            messages.append(message)
            if not message.get("more_body", False):
                break

        async def replay():
            if messages:
                return messages.pop(0)
            return {"type": "http.request", "body": b"", "more_body": False}

        await self.app(scope, replay, send)


class SecurityHeadersMiddleware:
    """Baseline security headers. HSTS HTTPS-only."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        headers_in = {k.decode("latin-1").lower(): v.decode("latin-1")
                      for k, v in scope.get("headers", [])}
        is_https = scope.get("scheme") == "https" or \
            headers_in.get("x-forwarded-proto", "").split(",")[0].strip() == "https"

        async def send_with_headers(message):
            if message.get("type") == "http.response.start":
                existing = [(k.decode("latin-1").lower(), v) for k, v in message.get("headers", [])]
                present = {k for k, _ in existing}
                extra = [
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"referrer-policy", b"strict-origin-when-cross-origin"),
                    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
                ]
                if is_https:
                    extra.append(
                        (b"strict-transport-security",
                         b"max-age=63072000; includeSubDomains"))
                for name, value in extra:
                    if name.decode("latin-1") not in present:
                        existing.append((name.decode("latin-1"), value))
                message = {**message, "headers": [
                    (k.encode("latin-1"), v) for k, v in existing]}
            await send(message)

        await self.app(scope, receive, send_with_headers)
