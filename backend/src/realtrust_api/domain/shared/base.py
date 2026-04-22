"""SQLAlchemy declarative base. Tables match backend/scripts/02-schema.sql."""
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base for all ORM models. Schema is authoritative; ORM reflects it."""

    pass
