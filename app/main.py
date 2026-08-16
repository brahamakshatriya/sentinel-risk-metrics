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


app = FastAPI(
    title="Sentinel API",
    description="Phase 1: Data Pipeline & Portfolio Management",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS configuration - allow all in dev, restrict in production
ENV = os.getenv("ENVIRONMENT", "development")
if ENV == "production":
    allowed_origins = os.getenv("CORS_ALLOWED_ORIGINS", "").split(",")
    allowed_origins = [o.strip() for o in allowed_origins if o.strip()]
    logger.info(f"Production CORS: allowed origins = {allowed_origins}")
else:
    allowed_origins = ["*"]
    logger.info("Development CORS: allowing all origins")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global exception handlers
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "internal_server_error",
            "message": "An unexpected error occurred. Please try again later.",
            "detail": str(exc) if ENV == "development" else None,
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.warning(f"Validation error: {exc.errors()}")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": "validation_error",
            "message": "Invalid request data",
            "details": exc.errors(),
        },
    )


app.include_router(portfolios.router, prefix="/api/v1")
app.include_router(ingestion.router, prefix="/api/v1")


@app.get("/health")
def health_check():
    """Health check with database connectivity verification."""
    db_status = "disconnected"
    db_error = None
    
    try:
        with get_db_session() as db:
            db.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception as e:
        db_status = "disconnected"
        db_error = str(e)
        logger.error(f"Health check DB error: {e}")
    
    return {
        "status": "healthy" if db_status == "connected" else "degraded",
        "database": db_status,
        "database_error": db_error,
        "version": "1.0.0",
        "environment": ENV,
    }


@app.get("/")
def root():
    return {
        "message": "Sentinel API",
        "docs": "/docs",
        "health": "/health",
        "version": "1.0.0"
    }