from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from contextlib import asynccontextmanager
import logging
import os
from sqlalchemy import text

from app.db.database import engine, get_db_session
from app.models import Base
from app.routers import portfolios, ingestion
from app.security.errors import (
    BudgetExceededError,
    ComputeBusyError,
    IngestionBusyError,
    QuotaExceededError,
    RateLimitedError,
)
from app.security.http import BodySizeLimitMiddleware, SecurityHeadersMiddleware

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Sentinel API...")
    Base.metadata.create_all(bind=engine)
    yield
    logger.info("Shutting down Sentinel API...")


# Module-level environment (read at request time so tests can monkeypatch).
ENV = os.getenv("ENVIRONMENT", "development")


def docs_enabled(environment: str | None = None) -> bool:
    """Interactive API docs are dev-only unless explicitly enabled.

    Production disables /docs, /redoc, and the OpenAPI schema to reduce
    information disclosure. Local development workflow is unchanged.
    """
    env = environment if environment is not None else os.getenv("ENVIRONMENT", "development")
    if env != "production":
        return True
    return os.getenv("S2_ENABLE_DOCS", "false").lower() == "true"


def create_app(environment: str | None = None) -> FastAPI:
    """Application factory (S2: enables prod/dev configuration tests)."""
    env = environment if environment is not None else os.getenv("ENVIRONMENT", "development")
    enable_docs = docs_enabled(env)

    application = FastAPI(
        title="Sentinel API",
        description="Phase 1: Data Pipeline & Portfolio Management",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if enable_docs else None,
        redoc_url="/redoc" if enable_docs else None,
        openapi_url="/openapi.json" if enable_docs else None,
    )

    # CORS configuration - allow all in dev, restrict in production
    if env == "production":
        allowed_origins = os.getenv("CORS_ALLOWED_ORIGINS", "").split(",")
        allowed_origins = [o.strip() for o in allowed_origins if o.strip()]
        logger.info(f"Production CORS: allowed origins = {allowed_origins}")
    else:
        allowed_origins = ["*"]
        logger.info("Development CORS: allowing all origins")

    application.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # S2 HTTP layer. Added body-guard first, headers second, so the
    # headers middleware is outermost and also covers 413 rejections.
    application.add_middleware(BodySizeLimitMiddleware)
    application.add_middleware(SecurityHeadersMiddleware)

    # Global exception handlers
    @application.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        # S3: pool exhaustion fails cleanly as 503 (not 500) with an
        # abuse signal; the client body stays sanitized either way.
        import sqlalchemy.exc as _sa_exc
        if isinstance(exc, _sa_exc.TimeoutError):
            from app.security import resource_limits as _limits
            from app.security.events import note_abuse as _note_abuse
            from app.security.rate_limit import client_ip as _client_ip
            _note_abuse("db_pool_exhaustion", _client_ip(request),
                        threshold=1, window_seconds=_limits.ABUSE_WINDOW_SECONDS,
                        path=request.url.path)
            return JSONResponse(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                content={"error": "service_unavailable",
                         "message": "Database is busy. Please retry shortly."},
                headers={"Retry-After": "5"},
            )
        logger.error(f"Unhandled exception: {type(exc).__name__}", exc_info=True)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "error": "internal_server_error",
                "message": "An unexpected error occurred. Please try again later.",
                "detail": str(exc) if ENV == "development" else None,
            },
        )

    @application.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        logger.warning(f"Validation error: {exc.errors()}")
        # Sanitize: exc.errors() may contain non-serializable ctx values
        # (e.g. ValueError) which would turn a 422 into a 500.
        safe_details = []
        for err in exc.errors():
            safe_details.append(
                {
                    "loc": list(err.get("loc", [])),
                    "msg": str(err.get("msg", "")),
                    "type": str(err.get("type", "")),
                }
            )
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "error": "validation_error",
                "message": "Invalid request data",
                "details": safe_details,
            },
        )

    # --- Phase S1 resource failure contract (flat, machine-readable) -----------
    # S3: rejection handlers also feed the log-only abuse tracker (safe
    # fields only: path + code; user identity is logged at raise sites).
    @application.exception_handler(RateLimitedError)
    async def rate_limited_handler(request: Request, exc: RateLimitedError):
        from app.security import resource_limits as _limits
        from app.security.events import note_abuse as _note_abuse
        from app.security.rate_limit import client_ip as _client_ip
        _note_abuse("repeated_429", f"{_client_ip(request)}:{exc.endpoint_class}",
                    threshold=_limits.ABUSE_REPEATED_429,
                    window_seconds=_limits.ABUSE_WINDOW_SECONDS,
                    path=request.url.path, endpoint_class=exc.endpoint_class)
        return JSONResponse(
            status_code=429,
            content={"error": "rate_limited", "retry_after": exc.retry_after},
            headers={"Retry-After": str(exc.retry_after)},
        )

    @application.exception_handler(ComputeBusyError)
    async def compute_busy_handler(request: Request, exc: ComputeBusyError):
        from app.security import resource_limits as _limits
        from app.security.events import note_abuse as _note_abuse
        from app.security.rate_limit import client_ip as _client_ip
        _note_abuse("compute_busy", _client_ip(request),
                    threshold=_limits.ABUSE_REPEATED_429,
                    window_seconds=_limits.ABUSE_WINDOW_SECONDS,
                    path=request.url.path, operation=exc.operation)
        return JSONResponse(
            status_code=429,
            content={"error": "compute_busy", "retry_after": exc.retry_after},
            headers={"Retry-After": str(exc.retry_after)},
        )

    @application.exception_handler(IngestionBusyError)
    async def ingestion_busy_handler(request: Request, exc: IngestionBusyError):
        from app.security import resource_limits as _limits
        from app.security.events import note_abuse as _note_abuse
        from app.security.rate_limit import client_ip as _client_ip
        _note_abuse("ingestion_busy", _client_ip(request),
                    threshold=_limits.ABUSE_REPEATED_429,
                    window_seconds=_limits.ABUSE_WINDOW_SECONDS,
                    path=request.url.path)
        return JSONResponse(
            status_code=429,
            content={"error": "ingestion_busy", "retry_after": exc.retry_after},
            headers={"Retry-After": str(exc.retry_after)},
        )

    @application.exception_handler(BudgetExceededError)
    async def budget_exceeded_handler(request: Request, exc: BudgetExceededError):
        from app.security import resource_limits as _limits
        from app.security.events import note_abuse as _note_abuse
        from app.security.rate_limit import client_ip as _client_ip
        _note_abuse("repeated_413", f"{_client_ip(request)}:{exc.error}",
                    threshold=_limits.ABUSE_REPEATED_413,
                    window_seconds=_limits.ABUSE_WINDOW_SECONDS,
                    path=request.url.path, code=exc.error)
        return JSONResponse(
            status_code=413,
            content={"error": exc.error, "message": exc.message, "details": exc.details},
        )

    @application.exception_handler(QuotaExceededError)
    async def quota_exceeded_handler(request: Request, exc: QuotaExceededError):
        from app.security import resource_limits as _limits
        from app.security.events import note_abuse as _note_abuse
        from app.security.rate_limit import client_ip as _client_ip
        _note_abuse("quota_exceeded", _client_ip(request),
                    threshold=_limits.ABUSE_REPEATED_429,
                    window_seconds=_limits.ABUSE_WINDOW_SECONDS,
                    path=request.url.path)
        return JSONResponse(
            status_code=429,
            content={"error": "business_quota_exceeded",
                     "retry_after": exc.retry_after,
                     "details": {"used": exc.used, "quota": exc.quota,
                                 "requested": exc.requested}},
            headers={"Retry-After": str(exc.retry_after)},
        )

    application.include_router(portfolios.router, prefix="/api/v1")
    application.include_router(ingestion.router, prefix="/api/v1")

    @application.get("/health")
    def health_check():
        """Health check with database connectivity verification.

        Production responses never expose raw DB exception strings,
        connection strings, hostnames, paths, or internals — a minimal
        degraded status is returned instead. Development stays verbose.
        """
        db_status = "disconnected"
        db_error = None

        try:
            with get_db_session() as db:
                db.execute(text("SELECT 1"))
            db_status = "connected"
        except Exception as e:
            db_status = "disconnected"
            logger.error("Health check DB failure")
            if ENV != "production":
                db_error = str(e)

        return {
            "status": "healthy" if db_status == "connected" else "degraded",
            "database": db_status,
            "database_error": db_error,
            "version": "1.0.0",
            "environment": ENV,
        }

    @application.get("/")
    def root():
        return {
            "message": "Sentinel API",
            "docs": "/docs",
            "health": "/health",
            "version": "1.0.0"
        }

    return application


app = create_app()
