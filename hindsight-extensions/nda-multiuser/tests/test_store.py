"""AuthStore behavior against a real PostgreSQL."""

import pytest

from nda_hindsight_multiuser import store as store_mod
from nda_hindsight_multiuser.store import (
    HandleTaken,
    InvalidHandle,
    NotFound,
    normalize_handle,
    schema_for,
)

ACTOR = "admin:ops"


def test_normalize_handle():
    assert normalize_handle("Alice") == "alice"
    assert normalize_handle("jane-doe") == "jane_doe"
    assert schema_for("alice") == "u_alice"
    # "jane-doe" normalizes to the valid "jane_doe"; a trailing dash likewise
    # becomes a valid trailing underscore, so it is not in the bad list.
    for bad in ["", "1abc", "a", "-abc", "x" * 42, "a b", "Älice", "ab.c"]:
        with pytest.raises(InvalidHandle):
            normalize_handle(bad)


async def test_init_schema_idempotent(store):
    await store.init_schema()  # second call must not raise
    assert await store.list_users() == []


async def test_create_and_list_user(store):
    u = await store.create_user("Alice", "Alice A.", actor=ACTOR)
    assert u.handle == "alice"
    assert u.schema_name == "u_alice"
    assert u.status == "active"
    users = await store.list_users()
    assert [x.handle for x in users] == ["alice"]


async def test_duplicate_handle_rejected(store):
    await store.create_user("alice", "A", actor=ACTOR)
    with pytest.raises(HandleTaken):
        await store.create_user("Alice", "dup", actor=ACTOR)


async def test_update_and_status(store):
    await store.create_user("bob", "Bob", actor=ACTOR)
    u = await store.update_user("bob", display_name="Bobby", actor=ACTOR)
    assert u.display_name == "Bobby"
    u = await store.set_user_status("bob", "disabled", actor=ACTOR)
    assert u.status == "disabled"
    # disabled users drop out of the worker's tenant list
    assert await store.list_active_schemas() == []
    u = await store.set_user_status("bob", "active", actor=ACTOR)
    assert await store.list_active_schemas() == ["u_bob"]


async def test_multiple_active_keys_and_independent_revoke(store):
    await store.create_user("alice", "A", actor=ACTOR)
    k1, r1 = await store.issue_user_key("alice", "laptop", actor=ACTOR)
    k2, r2 = await store.issue_user_key("alice", "desktop", actor=ACTOR)
    # Both authenticate to the same schema.
    a1 = await store.authenticate(k1.full)
    a2 = await store.authenticate(k2.full)
    assert a1 and a1.schema_name == "u_alice"
    assert a2 and a2.schema_name == "u_alice"
    # Two active keys listed.
    assert sorted(x.status for x in await store.list_user_keys("alice")) == ["active", "active"]
    # Revoke one; the other still works.
    await store.revoke_key(r1.id, actor=ACTOR)
    assert await store.authenticate(k1.full) is None
    assert (await store.authenticate(k2.full)).schema_name == "u_alice"


async def test_wrong_secret_and_malformed(store):
    await store.create_user("alice", "A", actor=ACTOR)
    k, _ = await store.issue_user_key("alice", "l", actor=ACTOR)
    assert await store.authenticate("ndak_" + k.prefix + "_wrongsecretwrongsecretwrongsecretwrongsecad") is None
    assert await store.authenticate("garbage") is None
    assert (await store.authenticate(k.full)) is not None


async def test_disable_blocks_all_keys_then_enable_restores(store):
    await store.create_user("alice", "A", actor=ACTOR)
    k1, _ = await store.issue_user_key("alice", "a", actor=ACTOR)
    k2, _ = await store.issue_user_key("alice", "b", actor=ACTOR)
    assert await store.authenticate(k1.full)
    await store.set_user_status("alice", "disabled", actor=ACTOR)
    assert await store.authenticate(k1.full) is None
    assert await store.authenticate(k2.full) is None
    await store.set_user_status("alice", "active", actor=ACTOR)
    assert await store.authenticate(k1.full)
    assert await store.authenticate(k2.full)


async def test_delete_user_revokes_keys_and_reserves_handle(store):
    await store.create_user("alice", "A", actor=ACTOR)
    k, _ = await store.issue_user_key("alice", "a", actor=ACTOR)
    await store.delete_user("alice", actor=ACTOR)
    assert await store.authenticate(k.full) is None
    # Gone from the list and the worker schema list.
    assert await store.list_users() == []
    assert await store.list_active_schemas() == []
    # Handle reserved: cannot be recreated (would reattach the old schema).
    with pytest.raises(HandleTaken):
        await store.create_user("alice", "A2", actor=ACTOR)
    # Idempotent.
    await store.delete_user("alice", actor=ACTOR)


async def test_admin_key_has_no_schema(store):
    k, _ = await store.issue_admin_key("ops", "bootstrap", actor="system")
    a = await store.authenticate(k.full)
    assert a and a.kind == "admin"
    assert a.admin_name == "ops"
    assert a.schema_name is None


async def test_issue_key_for_missing_user(store):
    with pytest.raises(NotFound):
        await store.issue_user_key("ghost", "x", actor=ACTOR)


async def test_cache_hit_rejects_wrong_secret(store):
    await store.create_user("alice", "A", actor=ACTOR)
    k, _ = await store.issue_user_key("alice", "a", actor=ACTOR)
    assert await store.authenticate(k.full)  # populate cache
    wrong = "ndak_" + k.prefix + "_" + ("z" * 43)
    assert await store.authenticate(wrong) is None  # cache hit, wrong secret


async def test_audit_has_no_secret(store):
    await store.create_user("alice", "A", actor=ACTOR)
    k, _ = await store.issue_user_key("alice", "a", actor=ACTOR)
    events = await store.list_audit()
    assert any(e["action"] == "key.issue" for e in events)
    blob = str(events)
    assert k.secret not in blob
    assert k.full not in blob


async def test_user_stats_counts_only(store):
    # A handle whose schema is not provisioned -> zeros, no error. (The shared
    # test DB may hold other provisioned u_* schemas, so use a fresh handle.)
    await store.create_user("statsunit", "S", actor=ACTOR)
    s = await store.user_stats("statsunit")
    assert s == {"banks": 0, "memories": 0, "documents": 0, "last_activity": None}


async def test_user_usage_zeros_when_no_schema(store):
    # Unprovisioned schema -> zero usage, no error (mirrors user_stats).
    await store.create_user("usageunit", "U", actor=ACTOR)
    u = await store.user_usage("usageunit")
    empty = {"calls": 0, "input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    assert u == {"total": empty, "last_30d": empty, "by_model": []}
