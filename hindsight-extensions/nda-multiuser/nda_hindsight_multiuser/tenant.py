"""Tenant extension: per-user API key -> isolated PostgreSQL schema.

Authenticates every REST and MCP request against the database-backed auth
store. A user key resolves to that user's schema; an admin key is rejected
here (401) so an admin can never reach memory data. New users' schemas are
provisioned on demand under a per-schema lock. The worker's ``list_tenants``
returns active users' schemas (short cache), so onboarding and offboarding
need no restart.
"""

from __future__ import annotations

import asyncio
import os
import time

from hindsight_api.extensions.tenant import (
    AuthenticationError,
    Tenant,
    TenantContext,
    TenantExtension,
)
from hindsight_api.models import RequestContext

from . import shared
from .store import KIND_USER, AuthStore

ENV_PEPPER = "HINDSIGHT_API_TENANT_KEY_PEPPER"
ENV_MCP_AUTH_TOKEN = "HINDSIGHT_API_MCP_AUTH_TOKEN"
ENV_MCP_AUTH_DISABLED = "HINDSIGHT_API_TENANT_MCP_AUTH_DISABLED"

__all__ = ["NdaTenantExtension"]


class NdaTenantExtension(TenantExtension):
    def __init__(self, config: dict[str, str]):
        super().__init__(config)
        # Pepper comes from HINDSIGHT_API_TENANT_KEY_PEPPER -> config["key_pepper"],
        # or the environment directly; it is a server-side secret.
        self._pepper = config.get("key_pepper") or os.getenv(ENV_PEPPER) or ""
        if not self._pepper:
            raise ValueError(f"{ENV_PEPPER} is required for NdaTenantExtension")
        # Either bypass var would let a caller reach memory without a per-user
        # key, defeating isolation. Refuse to start rather than run insecure.
        if os.getenv(ENV_MCP_AUTH_TOKEN):
            raise ValueError(f"{ENV_MCP_AUTH_TOKEN} must not be set with NdaTenantExtension (it bypasses per-user auth)")
        if os.getenv(ENV_MCP_AUTH_DISABLED):
            raise ValueError(f"{ENV_MCP_AUTH_DISABLED} must not be set with NdaTenantExtension")
        self._store: AuthStore | None = None
        self._tenant_cache: tuple[float, list[Tenant]] | None = None
        self._tenant_cache_ttl = 10.0
        self._provisioned: set[str] = set()
        self._provision_locks: dict[str, asyncio.Lock] = {}

    async def on_startup(self) -> None:
        engine = self.context.get_memory_engine()
        pool = await engine._get_pool()
        self._store = AuthStore(pool, pepper=self._pepper)
        await self._store.init_schema()
        shared.set_store(self._store)

    async def authenticate(self, context: RequestContext) -> TenantContext:
        if self._store is None:
            raise AuthenticationError("auth store not initialized")
        presented = context.api_key or ""
        result = await self._store.authenticate(presented)
        if result is None:
            raise AuthenticationError("invalid or inactive API key")
        if result.kind != KIND_USER:
            # Admin keys manage users/keys only; they never reach memory.
            raise AuthenticationError("admin key cannot access memory")
        await self._ensure_provisioned(result.schema_name)
        context.tenant_id = result.handle
        context.api_key_id = result.key_id
        return TenantContext(schema_name=result.schema_name)

    async def list_tenants(self) -> list[Tenant]:
        if self._store is None:
            return []
        now = time.monotonic()
        if self._tenant_cache is not None and self._tenant_cache[0] > now:
            return self._tenant_cache[1]
        schemas = await self._store.list_active_schemas()
        tenants = [Tenant(schema=s, tenant_id=s) for s in schemas]
        self._tenant_cache = (now + self._tenant_cache_ttl, tenants)
        return tenants

    async def _ensure_provisioned(self, schema: str) -> None:
        """Run core migrations for a user schema once, under a per-schema lock."""
        if schema in self._provisioned:
            return
        lock = self._provision_locks.setdefault(schema, asyncio.Lock())
        async with lock:
            if schema in self._provisioned:
                return
            await self.context.run_migration(schema)
            self._provisioned.add(schema)
