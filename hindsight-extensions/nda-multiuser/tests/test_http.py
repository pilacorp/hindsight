"""NdaHttpExtension management endpoints, via an in-loop ASGI client.

httpx.AsyncClient + ASGITransport drives the app in the test's event loop, the
same loop the asyncpg pool was created in (a sync TestClient would use a
different loop and break asyncpg's per-loop connections).
"""

import pytest

pytest.importorskip("hindsight_api")

import httpx  # noqa: E402
import pytest_asyncio  # noqa: E402
from fastapi import FastAPI  # noqa: E402

from nda_hindsight_multiuser import shared  # noqa: E402
from nda_hindsight_multiuser.http import NdaHttpExtension  # noqa: E402
from nda_hindsight_multiuser.store import AuthStore  # noqa: E402

PEPPER = "test-pepper-value"


class FakeContext:
    def __init__(self):
        self.migrated = []

    async def run_migration(self, schema):
        self.migrated.append(schema)


@pytest_asyncio.fixture
async def ctx(pool):
    store = AuthStore(pool, pepper=PEPPER)
    await store.init_schema()
    shared.set_store(store)
    admin_key, _ = await store.issue_admin_key("ops", "bootstrap", actor="system")

    ext = NdaHttpExtension({})
    ext.set_context(FakeContext())
    app = FastAPI()
    app.include_router(ext.get_router(memory=None), prefix="/ext")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        yield client, admin_key.full, ext


def _auth(key):
    return {"Authorization": f"Bearer {key}"}


async def test_requires_auth(ctx):
    c, _admin, _ext = ctx
    assert (await c.get("/ext/nda/v1/admin/users")).status_code == 401
    assert (await c.get("/ext/nda/v1/admin/users", headers=_auth("garbage"))).status_code == 401


async def test_user_crud_and_key_lifecycle(ctx):
    c, admin, ext = ctx
    r = await c.post("/ext/nda/v1/admin/users", json={"handle": "Alice", "display_name": "Alice A."}, headers=_auth(admin))
    assert r.status_code == 201, r.text
    assert r.json()["user"]["handle"] == "alice"
    assert "u_alice" in ext.context.migrated

    assert (await c.post("/ext/nda/v1/admin/users", json={"handle": "alice"}, headers=_auth(admin))).status_code == 409

    listed = (await c.get("/ext/nda/v1/admin/users", headers=_auth(admin))).json()["users"]
    assert [u["handle"] for u in listed] == ["alice"]

    r = await c.patch("/ext/nda/v1/admin/users/alice", json={"display_name": "Alicia"}, headers=_auth(admin))
    assert r.json()["user"]["display_name"] == "Alicia"

    k1 = (await c.post("/ext/nda/v1/admin/users/alice/keys", json={"label": "laptop"}, headers=_auth(admin))).json()["key"]
    k2 = (await c.post("/ext/nda/v1/admin/users/alice/keys", json={"label": "desktop"}, headers=_auth(admin))).json()["key"]
    assert (await c.get("/ext/nda/v1/me", headers=_auth(k1["secret"]))).json()["handle"] == "alice"
    assert (await c.get("/ext/nda/v1/me", headers=_auth(k2["secret"]))).json()["handle"] == "alice"
    keys = (await c.get("/ext/nda/v1/admin/users/alice/keys", headers=_auth(admin))).json()["keys"]
    assert sorted(k["status"] for k in keys) == ["active", "active"]

    await c.post(f"/ext/nda/v1/admin/keys/{k1['id']}/revoke", headers=_auth(admin))
    assert (await c.get("/ext/nda/v1/me", headers=_auth(k1["secret"]))).status_code == 401
    assert (await c.get("/ext/nda/v1/me", headers=_auth(k2["secret"]))).status_code == 200

    await c.post("/ext/nda/v1/admin/users/alice/disable", headers=_auth(admin))
    assert (await c.get("/ext/nda/v1/me", headers=_auth(k2["secret"]))).status_code == 401
    await c.post("/ext/nda/v1/admin/users/alice/enable", headers=_auth(admin))
    assert (await c.get("/ext/nda/v1/me", headers=_auth(k2["secret"]))).status_code == 200

    await c.delete("/ext/nda/v1/admin/users/alice", headers=_auth(admin))
    assert (await c.get("/ext/nda/v1/me", headers=_auth(k2["secret"]))).status_code == 401
    assert (await c.get("/ext/nda/v1/admin/users", headers=_auth(admin))).json()["users"] == []
    assert (await c.post("/ext/nda/v1/admin/users", json={"handle": "alice"}, headers=_auth(admin))).status_code == 409


async def test_admin_and_user_key_boundaries(ctx):
    c, admin, _ext = ctx
    assert (await c.get("/ext/nda/v1/me", headers=_auth(admin))).status_code == 403
    await c.post("/ext/nda/v1/admin/users", json={"handle": "bob"}, headers=_auth(admin))
    ukey = (await c.post("/ext/nda/v1/admin/users/bob/keys", json={}, headers=_auth(admin))).json()["key"]["secret"]
    assert (await c.get("/ext/nda/v1/admin/users", headers=_auth(ukey))).status_code == 403
    assert (await c.get("/ext/nda/v1/me", headers=_auth(ukey))).status_code == 200


async def test_secret_only_returned_at_issue(ctx):
    c, admin, _ext = ctx
    await c.post("/ext/nda/v1/admin/users", json={"handle": "carol"}, headers=_auth(admin))
    issued = (await c.post("/ext/nda/v1/admin/users/carol/keys", json={}, headers=_auth(admin))).json()["key"]
    assert "secret" in issued
    listed = (await c.get("/ext/nda/v1/admin/users/carol/keys", headers=_auth(admin))).json()["keys"]
    assert all("secret" not in k for k in listed)


async def test_audit_excludes_secrets(ctx):
    c, admin, _ext = ctx
    await c.post("/ext/nda/v1/admin/users", json={"handle": "dan"}, headers=_auth(admin))
    issued = (await c.post("/ext/nda/v1/admin/users/dan/keys", json={}, headers=_auth(admin))).json()["key"]["secret"]
    events = (await c.get("/ext/nda/v1/admin/audit", headers=_auth(admin))).json()["events"]
    assert issued not in str(events)
