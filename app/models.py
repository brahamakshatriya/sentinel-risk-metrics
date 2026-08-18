import enum
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import (
    Column, Integer, String, Date, DateTime, Numeric, ForeignKey, UniqueConstraint, Index, Enum
)
from sqlalchemy.orm import relationship, declarative_base

Base = declarative_base()


class PermissionLevel(str, enum.Enum):
    view = "view"
    edit = "edit"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    clerk_user_id = Column(String(255), unique=True, nullable=False, index=True)
    email = Column(String(255), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    owned_portfolios = relationship("Portfolio", back_populates="owner")
    shares = relationship("PortfolioShare", foreign_keys="PortfolioShare.shared_with_user_id", back_populates="shared_with_user")
    created_shares = relationship("PortfolioShare", foreign_keys="PortfolioShare.created_by_user_id", back_populates="created_by_user")


class Portfolio(Base):
    __tablename__ = "portfolios"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    owner = relationship("User", back_populates="owned_portfolios")
    holdings = relationship("Holding", back_populates="portfolio", cascade="all, delete-orphan")
    shares = relationship("PortfolioShare", back_populates="portfolio", cascade="all, delete-orphan")


class Holding(Base):
    __tablename__ = "holdings"

    id = Column(Integer, primary_key=True, index=True)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id", ondelete="CASCADE"), nullable=False, index=True)
    symbol = Column(String(20), nullable=False, index=True)
    quantity = Column(Numeric(18, 6), nullable=False)
    avg_cost = Column(Numeric(18, 6), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("portfolio_id", "symbol", name="uq_portfolio_symbol"),
    )

    portfolio = relationship("Portfolio", back_populates="holdings")


class PriceHistory(Base):
    __tablename__ = "price_history"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    open = Column(Numeric(12, 4))
    high = Column(Numeric(12, 4))
    low = Column(Numeric(12, 4))
    close = Column(Numeric(12, 4), nullable=False)
    adjusted_close = Column(Numeric(12, 4))
    volume = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("symbol", "date", name="uq_symbol_date"),
        Index("ix_symbol_date_desc", "symbol", "date"),
    )


class RiskFreeRateCache(Base):
    __tablename__ = "risk_free_rate_cache"

    id = Column(Integer, primary_key=True, index=True)
    series_id = Column(String(50), nullable=False, index=True)
    rate = Column(Numeric(10, 6), nullable=False)
    fetched_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("series_id", "fetched_at", name="uq_series_fetched"),
    )


class PortfolioShare(Base):
    __tablename__ = "portfolio_shares"

    id = Column(Integer, primary_key=True, index=True)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id", ondelete="CASCADE"), nullable=False, index=True)
    shared_with_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    permission = Column(Enum(PermissionLevel, name="permission_level"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    __table_args__ = (
        UniqueConstraint("portfolio_id", "shared_with_user_id", name="uq_portfolio_shared_user"),
    )

    portfolio = relationship("Portfolio", back_populates="shares")
    shared_with_user = relationship("User", foreign_keys=[shared_with_user_id], back_populates="shares")
    created_by_user = relationship("User", foreign_keys=[created_by_user_id], back_populates="created_shares")