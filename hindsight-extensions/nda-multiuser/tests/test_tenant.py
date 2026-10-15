"""NdaTenantExtension authentication and provisioning.

Requires the server package (hindsight_api) for the base classes, and a
PostgreSQL (NDA_TEST_DATABASE_URL). Skipped when either is absent.
"""

import os

import pytest

pytest.importorskip("hindsight_api")

from hindsight_api.extensions.tenant import AuthenticationError  # noqa: E402
from hindsight_api.models import RequestContext  # noqa: E402

from nda_hindsight_multiuser import shared  # noqa: E402
from nda_hindsight_multiuser.store import AuthStore  # noqa: E402
from nda_hindsight_multiuser.tenant import NdaTenantExtension  # noqa: E402

ACTOR = "admin:ops"


class FakeEngine:
    def __init__(self, pool):
        self._pool = pool

    async def _get_pool(self):
        return self._pool


class FakeContext:
    """Minimal ExtensionContext: provides the engine and records migrations."""

    def __init__(self, pool):
        self._engine = FakeEngine(pool)
        self.migrated: list[str] = []

    def get_memory_engine(self):
        return self._engine

    async def run_migration(self, schema: str) -> None:
        self.migrated.append(schema)


@pytest.fixture(autouse=True)
def _pepper_env(monkeypatch):
    monkeypatch.setenv("HINDSIGHT_API_TENANT_KEY_PEPPER", "test-pepper")
    monkeypatch.delenv("HINDSIGHT_API_MCP_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("HINDSIGHT_API_TENANT_MCP_AUTH_DISABLED", raising=False)


async def _started_ext(pool):
    ext = NdaTenantExtension({})
    ctx = FakeContext(pool)
    ext.set_context(ctx)
    await ext.on_startup()
    return ext, ctx


async def test_user_key_authenticates_and_provisions(pool):
    ext, ctx = await _started_ext(pool)
    store = shared.get_store()
    await store.create_user("alice", "A", actor=ACTOR)
    k, _ = await store.issue_user_key("alice", "l", actor=ACTOR)

    rc = RequestContext(api_key=k.full)
    tenant = await ext.authenticate(rc)
    assert tenant.schema_name == "u_alice"
    assert rc.tenant_id == "alice"
    assert "u_alice" in ctx.migrated  # provisioned once
    # Second auth does not re-provision.
    await ext.authenticate(RequestContext(api_key=k.full))
    assert ctx.migrated.count("u_alice") == 1


async def test_admin_key_rejected_from_memory(pool):
    ext, _ = await _started_ext(pool)
    store = shared.get_store()
    k, _ = await store.issue_admin_key("ops", "b", actor="system")
    with pytest.raises(AuthenticationError):
        await ext.authenticate(RequestContext(api_key=k.full))


async def test_invalid_and_revoked_keys_rejected(pool):
    ext, _ = await _started_ext(pool)
    store = shared.get_store()
    await store.create_user("bob", "B", actor=ACTOR)
    k, row = await store.issue_user_key("bob", "l", actor=ACTOR)
    assert (await ext.authenticate(RequestContext(api_key=k.full))).schema_name == "u_bob"
    await store.revoke_key(row.id, actor=ACTOR)
    with pytest.raises(AuthenticationError):
        await ext.authenticate(RequestContext(api_key=k.full))
    with pytest.raises(AuthenticationError):
        await ext.authenticate(RequestContext(api_key="garbage"))


async def test_list_tenants_tracks_active_users(pool):
    ext, _ = await _started_ext(pool)
    store = shared.get_store()
    await store.create_user("alice", "A", actor=ACTOR)
    await store.create_user("bob", "B", actor=ACTOR)
    ext._tenant_cache = None
    schemas = {t.schema for t in await ext.list_tenants()}
    assert schemas == {"u_alice", "u_bob"}
    await store.set_user_status("bob", "disabled", actor=ACTOR)
    ext._tenant_cache = None
    schemas = {t.schema for t in await ext.list_tenants()}
    assert schemas == {"u_alice"}


def test_refuses_mcp_bypass_env(monkeypatch):
    monkeypatch.setenv("HINDSIGHT_API_TENANT_KEY_PEPPER", "p")
    monkeypatch.setenv("HINDSIGHT_API_MCP_AUTH_TOKEN", "x")
    with pytest.raises(ValueError):
        NdaTenantExtension({})


def test_requires_pepper(monkeypatch):
    monkeypatch.delenv("HINDSIGHT_API_TENANT_KEY_PEPPER", raising=False)
    with pytest.raises(ValueError):
        NdaTenantExtension({})
