from __future__ import annotations

from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from app.core.settings import settings


def _psycopg_dsn() -> str:
    # Support either SQLAlchemy-style URL or psycopg direct URL.
    return settings.database_url.replace("+psycopg", "")


@contextmanager
def get_conn():
    conn = psycopg.connect(_psycopg_dsn(), row_factory=dict_row)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
