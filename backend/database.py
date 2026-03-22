import sqlite3
import os
from contextlib import contextmanager

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "prices.db")


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with get_db() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS prices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                time_slot TEXT NOT NULL,
                gold_22k REAL,
                gold_24k REAL,
                silver REAL,
                UNIQUE(date, time_slot)
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_prices_date ON prices(date)"
        )


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def insert_price(data):
    with get_db() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO prices
                (date, timestamp, time_slot, gold_22k, gold_24k, silver)
            VALUES
                (:date, :timestamp, :time_slot, :gold_22k, :gold_24k, :silver)
            """,
            data,
        )


def insert_prices_bulk(rows):
    """Insert multiple price rows in a single transaction."""
    with get_db() as conn:
        conn.executemany(
            """
            INSERT OR IGNORE INTO prices
                (date, timestamp, time_slot, gold_22k, gold_24k, silver)
            VALUES
                (:date, :timestamp, :time_slot, :gold_22k, :gold_24k, :silver)
            """,
            rows,
        )


def query_prices(start_date, end_date):
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT * FROM prices
            WHERE date BETWEEN ? AND ?
            ORDER BY date ASC, time_slot ASC
            """,
            (start_date, end_date),
        ).fetchall()
        return [dict(r) for r in rows]


def get_latest():
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM prices ORDER BY date DESC, id DESC LIMIT 1"
        ).fetchone()
        return dict(row) if row else None


def count_rows():
    with get_db() as conn:
        row = conn.execute("SELECT COUNT(*) as cnt FROM prices").fetchone()
        return row["cnt"] if row else 0
