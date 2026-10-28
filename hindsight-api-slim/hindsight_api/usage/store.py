"""Shared ``hindsight_usage.daily`` ledger. Not copied into tenant schemas."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from hindsight_api.usage.http import UsageReadError
from hindsight_api.usage.view import COUNTERS, DailyUsage, Member, schema_from_user_id

logger = logging.getLogger(__name__)

_STORE: UsageStore | None = None

_ENSURE = """
CREATE SCHEMA IF NOT EXISTS hindsight_usage;
CREATE TABLE IF NOT EXISTS hindsight_usage.daily (
    user_id uuid NOT NULL,
    day date NOT NULL,
    retain_success integer NOT NULL DEFAULT 0,
    retain_failure integer NOT NULL DEFAULT 0,
    recall_success integer NOT NULL DEFAULT 0,
    recall_failure integer NOT NULL DEFAULT 0,
    reflect_success integer NOT NULL DEFAULT 0,
    reflect_failure integer NOT NULL DEFAULT 0,
    input_tokens integer NOT NULL DEFAULT 0,
    output_tokens integer NOT NULL DEFAULT 0,
    cached_input_tokens integer NOT NULL DEFAULT 0,
    banks integer,
    documents integer,
    memory_units integer,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, day)
)
"""

_COUNT_COLUMNS = ", ".join(COUNTERS)
_INSERT_PLACEHOLDERS = ", ".join(f"${index}" for index in range(3, 3 + len(COUNTERS)))
_ADD_ASSIGNMENTS = ", ".join(f"{column} = hindsight_usage.daily.{column} + EXCLUDED.{column}" for column in COUNTERS)
_UPSERT_COUNTS = f"""
INSERT INTO hindsight_usage.daily (user_id, day, {_COUNT_COLUMNS})
VALUES ($1::uuid, $2::date, {_INSERT_PLACEHOLDERS})
ON CONFLICT (user_id, day) DO UPDATE SET
    {_ADD_ASSIGNMENTS},
    updated_at = now()
"""

_UPSERT_FOOTPRINT = """
INSERT INTO hindsight_usage.daily (user_id, day, banks, documents, memory_units)
VALUES ($1::uuid, $2::date, $3, $4, $5)
ON CONFLICT (user_id, day) DO UPDATE SET
    banks = EXCLUDED.banks,
    documents = EXCLUDED.documents,
    memory_units = EXCLUDED.memory_units,
    updated_at = now()
"""


def get_usage_store() -> UsageStore | None:
    return _STORE


def bind_usage_store(pool) -> UsageStore:
    """Remember the pool. Schema creation happens on first use and on initialize."""
    global _STORE
    _STORE = UsageStore(pool)
    return _STORE


def clear_usage_store() -> None:
    global _STORE
    _STORE = None


class UsageStore:
    def __init__(self, pool) -> None:
        self._pool = pool

    async def ensure_schema(self) -> None:
        schema_sql, table_sql = _ENSURE.split(";", 1)
        async with self._pool.acquire() as conn:
            await conn.execute(schema_sql)
            await conn.execute(table_sql)

    async def add_counts(self, user_id: str, day: date, delta: dict[str, int]) -> None:
        """Add activity or token counts. A database failure is logged and not raised."""
        values = [int(delta.get(column, 0)) for column in COUNTERS]
        if not any(values):
            return
        try:
            async with self._pool.acquire() as conn:
                await conn.execute(_UPSERT_COUNTS, user_id, day, *values)
        except Exception:
            logger.exception("Usage counter write failed for %s", user_id)

    async def load_members_and_rows(self) -> tuple[list[Member], list[DailyUsage]]:
        start = datetime.now(timezone.utc).date() - timedelta(days=29)
        try:
            async with self._pool.acquire() as conn:
                users = await conn.fetch("SELECT id::text AS id, email FROM auth.users")
                daily = await conn.fetch(
                    f"""
                    SELECT user_id::text AS user_id, day, {_COUNT_COLUMNS},
                           banks, documents, memory_units, updated_at
                    FROM hindsight_usage.daily
                    WHERE day >= $1
                    """,
                    start,
                )
        except Exception as exc:
            raise UsageReadError(str(exc)) from exc
        members = [Member(str(row["id"]), row["email"]) for row in users]
        rows = [
            DailyUsage(
                user_id=str(row["user_id"]),
                day=row["day"],
                retain_success=row["retain_success"],
                retain_failure=row["retain_failure"],
                recall_success=row["recall_success"],
                recall_failure=row["recall_failure"],
                reflect_success=row["reflect_success"],
                reflect_failure=row["reflect_failure"],
                input_tokens=row["input_tokens"],
                output_tokens=row["output_tokens"],
                cached_input_tokens=row["cached_input_tokens"],
                banks=row["banks"],
                documents=row["documents"],
                memory_units=row["memory_units"],
                updated_at=row["updated_at"],
            )
            for row in daily
        ]
        return members, rows

    async def snapshot_footprints(self, prefix: str = "user") -> None:
        """Store today's bank, document, and memory-unit counts. Missing schemas store zeros."""
        today = datetime.now(timezone.utc).date()
        async with self._pool.acquire() as conn:
            users = await conn.fetch("SELECT id::text AS id FROM auth.users")
            for row in users:
                user_id = str(row["id"])
                schema = schema_from_user_id(user_id, prefix)
                if schema is None:
                    continue
                exists = await conn.fetchval("SELECT 1 FROM pg_namespace WHERE nspname = $1", schema)
                if not exists:
                    banks = documents = memory_units = 0
                else:
                    try:
                        counted = await conn.fetchrow(
                            f"""
                            SELECT
                                (SELECT count(*) FROM "{schema}".banks) AS banks,
                                (SELECT count(*) FROM "{schema}".documents) AS documents,
                                (SELECT count(*) FROM "{schema}".memory_units) AS memory_units
                            """
                        )
                    except Exception:
                        logger.exception("Usage footprint count failed for %s", schema)
                        continue
                    banks = int(counted["banks"])
                    documents = int(counted["documents"])
                    memory_units = int(counted["memory_units"])
                await conn.execute(_UPSERT_FOOTPRINT, user_id, today, banks, documents, memory_units)
