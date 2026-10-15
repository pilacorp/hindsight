"""Auth store: users, API keys, and audit in a dedicated ``nda_auth`` schema.

The schema is created with idempotent DDL at startup (not Alembic — extension
Alembic revisions apply to every tenant schema, and these tables are global).
Only ``asyncpg`` is required, so the store is testable without the server.

Authentication is cached briefly so the per-request lookup is cheap; a revoke
or disable invalidates the cache in-process at once, and other replicas pick it
up within the TTL.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass

import asyncpg

from . import keys

# Handle rules: lowercase letters, digits, underscore; starts with a letter;
# 2-41 chars so ``u_<handle>`` stays within PostgreSQL's 63-byte identifier limit.
_HANDLE_RE = re.compile(r"^[a-z][a-z0-9_]{1,40}$")
SCHEMA_PREFIX = "u_"

STATUS_ACTIVE = "active"
STATUS_DISABLED = "disabled"
STATUS_DELETED = "deleted"

KIND_USER = "user"
KIND_ADMIN = "admin"


class StoreError(Exception):
    """Base for store errors."""


class HandleTaken(StoreError):
    """The handle is already in use or reserved by a deleted user."""


class InvalidHandle(StoreError):
    """The handle is not a valid, normalized identifier."""


class NotFound(StoreError):
    """No such user or key."""


def normalize_handle(raw: str) -> str:
    """Lowercase and map dashes to underscores, then validate.

    Mirrors how PostgreSQL folds unquoted identifiers, so ``Alice`` and
    ``alice`` cannot become two schemas. Rejects anything that would not be a
    safe, in-length identifier component.
    """
    if not isinstance(raw, str):
        raise InvalidHandle("handle must be a string")
    norm = raw.strip().lower().replace("-", "_")
    if not _HANDLE_RE.match(norm):
        raise InvalidHandle(f"invalid handle: {raw!r}")
    return norm


def schema_for(handle: str) -> str:
    return f"{SCHEMA_PREFIX}{handle}"


@dataclass(frozen=True)
class UserRow:
    handle: str
    display_name: str
    schema_name: str
    status: str


@dataclass(frozen=True)
class KeyRow:
    id: str
    kind: str
    user_handle: str | None
    admin_name: str | None
    prefix: str
    label: str
    created_at: object
    last_used_at: object
    revoked_at: object

    @property
    def status(self) -> str:
        return "revoked" if self.revoked_at is not None else "active"


@dataclass(frozen=True)
class AuthResult:
    kind: str  # KIND_USER | KIND_ADMIN
    handle: str | None  # user handle (KIND_USER)
    admin_name: str | None  # admin name (KIND_ADMIN)
    schema_name: str | None  # tenant schema (KIND_USER)
    key_id: str


class AuthStore:
    def __init__(
        self,
        pool: asyncpg.Pool,
        *,
        pepper: str,
        schema: str = "nda_auth",
        cache_ttl: float = 5.0,
        neg_ttl: float = 2.0,
    ) -> None:
        if not pepper:
            raise ValueError("pepper is required")
        self._pool = pool
        self._pepper = pepper
        self._schema = schema
        self._cache_ttl = cache_ttl
        self._neg_ttl = neg_ttl
        # prefix -> (expires_at, secret_hash | None, AuthResult | None).
        # Positive entry carries the secret hash so a cache hit re-verifies the
        # presented secret without a DB round-trip; the cache keys on the
        # non-secret prefix, so a wrong secret on a known prefix must still fail.
        # Negative entry (hash None, result None) is cached only for a
        # non-existent prefix or a revoked/expired/inactive key, both of which
        # are invalidated in-process on the state change.
        self._cache: dict[str, tuple[float, str | None, AuthResult | None]] = {}

    # --- schema -------------------------------------------------------------

    async def init_schema(self) -> None:
        """Create the auth schema and tables. Idempotent."""
        async with self._pool.acquire() as conn:
            await conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{self._schema}"')
            await conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS "{self._schema}".users (
                    handle        text PRIMARY KEY,
                    display_name  text NOT NULL,
                    schema_name   text NOT NULL UNIQUE,
                    status        text NOT NULL DEFAULT 'active',
                    created_at    timestamptz NOT NULL DEFAULT now(),
                    updated_at    timestamptz NOT NULL DEFAULT now()
                )
                """
            )
            await conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS "{self._schema}".api_keys (
                    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                    kind          text NOT NULL,
                    user_handle   text REFERENCES "{self._schema}".users(handle),
                    admin_name    text,
                    prefix        text NOT NULL UNIQUE,
                    secret_hash   text NOT NULL,
                    label         text NOT NULL DEFAULT '',
                    created_at    timestamptz NOT NULL DEFAULT now(),
                    last_used_at  timestamptz,
                    revoked_at    timestamptz,
                    expires_at    timestamptz
                )
                """
            )
            await conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS "{self._schema}".audit_events (
                    id       bigserial PRIMARY KEY,
                    at       timestamptz NOT NULL DEFAULT now(),
                    actor    text NOT NULL,
                    action   text NOT NULL,
                    target   text,
                    details  jsonb NOT NULL DEFAULT '{{}}'::jsonb
                )
                """
            )

    def _q(self, table: str) -> str:
        return f'"{self._schema}".{table}'

    # --- users --------------------------------------------------------------

    async def create_user(self, handle: str, display_name: str, *, actor: str) -> UserRow:
        norm = normalize_handle(handle)
        schema = schema_for(norm)
        async with self._pool.acquire() as conn:
            existing = await conn.fetchval(
                f"SELECT status FROM {self._q('users')} WHERE handle = $1", norm
            )
            if existing is not None:
                raise HandleTaken(f"handle {norm!r} is already in use or reserved")
            await conn.execute(
                f"INSERT INTO {self._q('users')} (handle, display_name, schema_name) VALUES ($1, $2, $3)",
                norm,
                display_name or norm,
                schema,
            )
            await self._record(conn, actor, "user.create", norm, {"display_name": display_name})
        return UserRow(norm, display_name or norm, schema, STATUS_ACTIVE)

    async def get_user(self, handle: str) -> UserRow | None:
        norm = normalize_handle(handle)
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                f"SELECT handle, display_name, schema_name, status FROM {self._q('users')} WHERE handle = $1",
                norm,
            )
        return _user_row(row) if row else None

    async def list_users(self) -> list[UserRow]:
        """All non-deleted users."""
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                f"SELECT handle, display_name, schema_name, status FROM {self._q('users')} "
                f"WHERE status <> '{STATUS_DELETED}' ORDER BY handle"
            )
        return [_user_row(r) for r in rows]

    async def list_active_schemas(self) -> list[str]:
        """Schemas of active users, for the worker's ``list_tenants``."""
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                f"SELECT schema_name FROM {self._q('users')} WHERE status = '{STATUS_ACTIVE}'"
            )
        return [r["schema_name"] for r in rows]

    async def update_user(self, handle: str, *, display_name: str, actor: str) -> UserRow:
        norm = normalize_handle(handle)
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                f"UPDATE {self._q('users')} SET display_name = $2, updated_at = now() "
                f"WHERE handle = $1 AND status <> '{STATUS_DELETED}' "
                f"RETURNING handle, display_name, schema_name, status",
                norm,
                display_name,
            )
            if row is None:
                raise NotFound(f"no such user: {norm!r}")
            await self._record(conn, actor, "user.update", norm, {"display_name": display_name})
        return _user_row(row)

    async def set_user_status(self, handle: str, status: str, *, actor: str) -> UserRow:
        if status not in (STATUS_ACTIVE, STATUS_DISABLED):
            raise ValueError(f"invalid status: {status}")
        norm = normalize_handle(handle)
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                f"UPDATE {self._q('users')} SET status = $2, updated_at = now() "
                f"WHERE handle = $1 AND status <> '{STATUS_DELETED}' "
                f"RETURNING handle, display_name, schema_name, status",
                norm,
                status,
            )
            if row is None:
                raise NotFound(f"no such user: {norm!r}")
            prefixes = await self._user_prefixes(conn, norm)
            await self._record(conn, actor, f"user.{status}", norm, {})
        self._invalidate_many(prefixes)
        return _user_row(row)

    async def delete_user(self, handle: str, *, actor: str) -> None:
        """Soft-delete: revoke all keys, mark deleted, keep the handle reserved.

        The user's schema and memories are retained (database-owner scope).
        Idempotent.
        """
        norm = normalize_handle(handle)
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                prefixes = await self._user_prefixes(conn, norm)
                await conn.execute(
                    f"UPDATE {self._q('api_keys')} SET revoked_at = now() "
                    f"WHERE user_handle = $1 AND revoked_at IS NULL",
                    norm,
                )
                await conn.execute(
                    f"UPDATE {self._q('users')} SET status = '{STATUS_DELETED}', updated_at = now() "
                    f"WHERE handle = $1",
                    norm,
                )
                await self._record(conn, actor, "user.delete", norm, {})
        self._invalidate_many(prefixes)

    # --- keys ---------------------------------------------------------------

    async def issue_user_key(self, handle: str, label: str, *, actor: str) -> tuple[keys.IssuedKey, KeyRow]:
        norm = normalize_handle(handle)
        async with self._pool.acquire() as conn:
            user = await conn.fetchrow(
                f"SELECT status FROM {self._q('users')} WHERE handle = $1", norm
            )
            if user is None or user["status"] == STATUS_DELETED:
                raise NotFound(f"no such user: {norm!r}")
            issued = keys.issue()
            row = await conn.fetchrow(
                f"INSERT INTO {self._q('api_keys')} (kind, user_handle, prefix, secret_hash, label) "
                f"VALUES ('{KIND_USER}', $1, $2, $3, $4) "
                f"RETURNING id, kind, user_handle, admin_name, prefix, label, created_at, last_used_at, revoked_at",
                norm,
                issued.prefix,
                keys.hash_secret(issued.secret, pepper=self._pepper),
                label or "",
            )
            await self._record(conn, actor, "key.issue", norm, {"prefix": issued.prefix, "label": label})
        return issued, _key_row(row)

    async def issue_admin_key(self, name: str, label: str, *, actor: str) -> tuple[keys.IssuedKey, KeyRow]:
        issued = keys.issue()
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                f"INSERT INTO {self._q('api_keys')} (kind, admin_name, prefix, secret_hash, label) "
                f"VALUES ('{KIND_ADMIN}', $1, $2, $3, $4) "
                f"RETURNING id, kind, user_handle, admin_name, prefix, label, created_at, last_used_at, revoked_at",
                name,
                issued.prefix,
                keys.hash_secret(issued.secret, pepper=self._pepper),
                label or "",
            )
            await self._record(conn, actor, "admin_key.issue", name, {"prefix": issued.prefix})
        return issued, _key_row(row)

    async def list_user_keys(self, handle: str) -> list[KeyRow]:
        norm = normalize_handle(handle)
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                f"SELECT id, kind, user_handle, admin_name, prefix, label, created_at, last_used_at, revoked_at "
                f"FROM {self._q('api_keys')} WHERE user_handle = $1 ORDER BY created_at",
                norm,
            )
        return [_key_row(r) for r in rows]

    async def revoke_key(self, key_id: str, *, actor: str) -> None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                f"UPDATE {self._q('api_keys')} SET revoked_at = now() "
                f"WHERE id = $1 AND revoked_at IS NULL "
                f"RETURNING prefix, user_handle",
                key_id,
            )
            if row is not None:
                await self._record(conn, actor, "key.revoke", row["user_handle"], {"prefix": row["prefix"]})
        if row is not None:
            self._invalidate_many([row["prefix"]])

    # --- authentication -----------------------------------------------------

    async def authenticate(self, presented: str) -> AuthResult | None:
        """Return the identity for a presented key, or ``None`` if it is not
        valid, revoked, expired, or belongs to a non-active user. Cached briefly."""
        parsed = keys.parse(presented)
        if parsed is None:
            return None
        now = time.monotonic()
        cached = self._cache.get(parsed.prefix)
        if cached is not None and cached[0] > now:
            _, secret_hash, result = cached
            if result is None or secret_hash is None:
                return None  # cached negative (unknown prefix / revoked / disabled)
            # Known-good prefix: the presented secret must match this prefix's
            # stored hash, so a wrong secret on a known prefix still fails.
            if keys.verify_secret(parsed.secret, pepper=self._pepper, stored_hash=secret_hash):
                return result
            return None

        secret_hash, result, cacheable = await self._authenticate_uncached(parsed)
        if cacheable:
            ttl = self._cache_ttl if result is not None else self._neg_ttl
            self._cache[parsed.prefix] = (now + ttl, secret_hash, result)
        return result

    async def _authenticate_uncached(
        self, parsed: keys.ParsedKey
    ) -> tuple[str | None, AuthResult | None, bool]:
        """Returns (secret_hash, result, cacheable).

        cacheable is False for a secret mismatch on an existing prefix — we do
        not want to cache a negative that a correct secret would have to wait
        out. Every other outcome is safe to cache (invalidated on state change).
        """
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                f"SELECT k.id, k.kind, k.user_handle, k.admin_name, k.secret_hash, k.revoked_at, k.expires_at, "
                f"       u.status AS user_status, u.schema_name "
                f"FROM {self._q('api_keys')} k "
                f"LEFT JOIN {self._q('users')} u ON u.handle = k.user_handle "
                f"WHERE k.prefix = $1",
                parsed.prefix,
            )
            if row is None:
                return None, None, True  # unknown prefix: cache negative
            if not keys.verify_secret(parsed.secret, pepper=self._pepper, stored_hash=row["secret_hash"]):
                return None, None, False  # wrong secret: do not cache
            if (
                row["revoked_at"] is not None
                or (row["expires_at"] is not None and row["expires_at"].timestamp() <= time.time())
                or (row["kind"] == KIND_USER and row["user_status"] != STATUS_ACTIVE)
            ):
                return None, None, True  # valid secret but not usable: cache negative
            # Best-effort last-used stamp; never blocks auth.
            await conn.execute(
                f"UPDATE {self._q('api_keys')} SET last_used_at = now() "
                f"WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')",
                row["id"],
            )
        result = AuthResult(
            kind=row["kind"],
            handle=row["user_handle"],
            admin_name=row["admin_name"],
            schema_name=row["schema_name"] if row["kind"] == KIND_USER else None,
            key_id=str(row["id"]),
        )
        return row["secret_hash"], result, True

    def invalidate(self, prefix: str) -> None:
        self._cache.pop(prefix, None)

    def _invalidate_many(self, prefixes: list[str]) -> None:
        for p in prefixes:
            self._cache.pop(p, None)

    async def _user_prefixes(self, conn: asyncpg.Connection, handle: str) -> list[str]:
        rows = await conn.fetch(
            f"SELECT prefix FROM {self._q('api_keys')} WHERE user_handle = $1", handle
        )
        return [r["prefix"] for r in rows]

    # --- audit --------------------------------------------------------------

    async def _record(self, conn, actor: str, action: str, target: str | None, details: dict) -> None:
        import json

        await conn.execute(
            f"INSERT INTO {self._q('audit_events')} (actor, action, target, details) VALUES ($1, $2, $3, $4::jsonb)",
            actor,
            action,
            target,
            json.dumps(details or {}),
        )

    async def user_stats(self, handle: str) -> dict:
        """Counts only (no memory content) for one user's schema: banks,
        memories, documents, and last activity. Returns zeros if the schema is
        not provisioned yet."""
        norm = normalize_handle(handle)
        schema = schema_for(norm)
        async with self._pool.acquire() as conn:
            exists = await conn.fetchval("SELECT 1 FROM pg_namespace WHERE nspname = $1", schema)
            if not exists:
                return {"banks": 0, "memories": 0, "documents": 0, "last_activity": None}
            # schema is derived from a validated handle; quote it as an identifier.
            banks = await conn.fetchval(f'SELECT count(*) FROM "{schema}".banks')
            memories = await conn.fetchval(f'SELECT count(*) FROM "{schema}".memory_units')
            documents = await conn.fetchval(f'SELECT count(*) FROM "{schema}".documents')
            last = await conn.fetchval(f'SELECT max(updated_at) FROM "{schema}".banks')
        return {"banks": banks, "memories": memories, "documents": documents, "last_activity": last}

    async def user_usage(self, handle: str) -> dict:
        """Per-user LLM token usage, read from the user's own schema
        (Hindsight records every LLM call there). OpenRouter bills one shared
        key and cannot attribute per user, so this is the authoritative
        per-user breakdown. Counts/tokens only, never prompt content."""
        norm = normalize_handle(handle)
        schema = schema_for(norm)
        empty = {"calls": 0, "input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        async with self._pool.acquire() as conn:
            exists = await conn.fetchval(
                "SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = 'llm_requests'", schema
            )
            if not exists:
                return {"total": empty, "last_30d": empty, "by_model": []}
            t = f'"{schema}".llm_requests'
            total = await conn.fetchrow(
                f"SELECT count(*) calls, coalesce(sum(input_tokens),0) input_tokens, "
                f"coalesce(sum(output_tokens),0) output_tokens, coalesce(sum(total_tokens),0) total_tokens FROM {t}"
            )
            recent = await conn.fetchrow(
                f"SELECT count(*) calls, coalesce(sum(input_tokens),0) input_tokens, "
                f"coalesce(sum(output_tokens),0) output_tokens, coalesce(sum(total_tokens),0) total_tokens "
                f"FROM {t} WHERE started_at >= now() - interval '30 days'"
            )
            by_model = await conn.fetch(
                f"SELECT model, count(*) calls, coalesce(sum(total_tokens),0) total_tokens FROM {t} "
                f"GROUP BY model ORDER BY total_tokens DESC NULLS LAST LIMIT 10"
            )
        return {
            "total": dict(total),
            "last_30d": dict(recent),
            "by_model": [dict(r) for r in by_model],
        }

    async def list_audit(self, limit: int = 100) -> list[dict]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                f"SELECT at, actor, action, target, details FROM {self._q('audit_events')} "
                f"ORDER BY id DESC LIMIT $1",
                limit,
            )
        return [dict(r) for r in rows]


def _user_row(row) -> UserRow:
    return UserRow(row["handle"], row["display_name"], row["schema_name"], row["status"])


def _key_row(row) -> KeyRow:
    return KeyRow(
        id=str(row["id"]),
        kind=row["kind"],
        user_handle=row["user_handle"],
        admin_name=row["admin_name"],
        prefix=row["prefix"],
        label=row["label"],
        created_at=row["created_at"],
        last_used_at=row["last_used_at"],
        revoked_at=row["revoked_at"],
    )
