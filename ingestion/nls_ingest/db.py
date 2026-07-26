"""Neon Postgres connection helpers for the ingestion pipeline."""

from __future__ import annotations

from contextlib import contextmanager
import time
from typing import Iterator

import psycopg

from . import config


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    """Yield a psycopg connection to Neon, committing on clean exit."""
    dsn = config.require_database_url()
    conn = None
    last_error = None
    for attempt in range(5):
        try:
            conn = psycopg.connect(dsn, connect_timeout=20)
            break
        except psycopg.OperationalError as exc:
            last_error = exc
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)
    if conn is None:  # defensive; the loop either connected or raised
        raise last_error or RuntimeError("Unable to connect to Neon")
    try:
        yield conn
        conn.commit()
    except Exception:
        # A dropped SSL socket cannot be rolled back; preserve the original
        # error so the caller can reconnect and retry the idempotent operation.
        try:
            conn.rollback()
        except psycopg.OperationalError:
            pass
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
