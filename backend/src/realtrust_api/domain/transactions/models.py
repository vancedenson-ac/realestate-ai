"""SQLAlchemy models for transaction state machine and parties (02-schema.sql)."""
import uuid
from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from realtrust_api.domain.shared.base import Base


class TransactionState(Base):
    __tablename__ = "transaction_states"

    state: Mapped[str] = mapped_column(String, primary_key=True)
    is_terminal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class TransactionStateTransition(Base):
    __tablename__ = "transaction_state_transitions"

    from_state: Mapped[str] = mapped_column(String, ForeignKey("transaction_states.state"), primary_key=True)
    to_state: Mapped[str] = mapped_column(String, ForeignKey("transaction_states.state"), primary_key=True)
    allowed_roles: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    required_documents: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default="{}")
    emits_event: Mapped[str] = mapped_column(String, nullable=False)


class User(Base):
    __tablename__ = "users"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    full_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Organization(Base):
    __tablename__ = "organizations"

    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Transaction(Base):
    __tablename__ = "transactions"

    transaction_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.organization_id"), nullable=False
    )
    current_state: Mapped[str] = mapped_column(String, ForeignKey("transaction_states.state"), nullable=False)
    state_entered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    jurisdiction: Mapped[str | None] = mapped_column(Text, nullable=True)
    offer_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    property_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    listing_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    organization: Mapped["Organization"] = relationship("Organization", back_populates="transactions")
    parties: Mapped[list["TransactionParty"]] = relationship(
        "TransactionParty", back_populates="transaction", cascade="all, delete-orphan"
    )


Organization.transactions = relationship("Transaction", back_populates="organization")


class TransactionParty(Base):
    __tablename__ = "transaction_parties"

    transaction_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("transactions.transaction_id"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.user_id"), primary_key=True)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.organization_id"), nullable=False
    )
    role: Mapped[str] = mapped_column(String, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    transaction: Mapped["Transaction"] = relationship("Transaction", back_populates="parties")
    user: Mapped["User"] = relationship("User")
    organization: Mapped["Organization"] = relationship("Organization")


class TransactionStateHistory(Base):
    __tablename__ = "transaction_state_history"

    history_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    transaction_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("transactions.transaction_id"), nullable=False
    )
    from_state: Mapped[str] = mapped_column(String, nullable=False)
    to_state: Mapped[str] = mapped_column(String, nullable=False)
    entered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    actor_role: Mapped[str] = mapped_column(String, nullable=False)
