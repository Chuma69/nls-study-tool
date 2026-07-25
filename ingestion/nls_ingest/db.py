"""Neon Postgres connection helpers for the ingestion pipeline."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import psycopg

from . import config


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    """Yield a psycopg connection to Neon, committing on clean exit."""
    dsn = config.require_database_url()
    conn = psycopg.connect(dsn)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def check_connection() -> dict[str, int]:
    """Phase 0 connectivity check: confirm we can reach Neon and that the
    expected tables exist. Returns current row counts."""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM questions)"
            )
            users, questions = cur.fetchone()
    return {"users": users, "questions": questions}
