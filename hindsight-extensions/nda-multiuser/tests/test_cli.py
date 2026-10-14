"""The admin bootstrap CLI."""

import os

import pytest

from nda_hindsight_multiuser import cli
from nda_hindsight_multiuser.store import AuthStore

PEPPER = "test-pepper-value"


async def test_create_admin_issues_working_key(pool, monkeypatch, capsys):
    url = os.environ["NDA_TEST_DATABASE_URL"]
    monkeypatch.setenv("HINDSIGHT_API_DATABASE_URL", url)
    monkeypatch.setenv("HINDSIGHT_API_TENANT_KEY_PEPPER", PEPPER)

    rc = await cli._create_admin("ops", "bootstrap")
    assert rc == 0
    out = capsys.readouterr().out
    # The key is printed once, with the ndak_ prefix.
    line = next(l for l in out.splitlines() if "ndak_" in l)
    key = line.split("key:")[1].strip()
    assert key.startswith("ndak_")

    # It authenticates as an admin against the same database.
    store = AuthStore(pool, pepper=PEPPER)
    result = await store.authenticate(key)
    assert result is not None and result.kind == "admin" and result.admin_name == "ops"


async def test_create_admin_requires_env(monkeypatch):
    monkeypatch.delenv("HINDSIGHT_API_DATABASE_URL", raising=False)
    monkeypatch.setenv("HINDSIGHT_API_TENANT_KEY_PEPPER", PEPPER)
    assert await cli._create_admin("ops", "x") == 2
