"""Shared fixtures: an asyncpg pool against a disposable PostgreSQL.

Set NDA_TEST_DATABASE_URL to point at a throwaway database. Each test gets a
freshly re-created ``nda_auth`` schema so tests are independent.
"""

import os

import asyncpg
import pytest
import pytest_asyncio

from nda_hindsight_multiuser.store import AuthStore

PEPPER = "test-pepper-value"


@pytest_asyncio.fixture
async def pool():
    url = os.environ.get("NDA_TEST_DATABASE_URL")
    if not url:
        pytest.skip("NDA_TEST_DATABASE_URL not set")
    pool = await asyncpg.create_pool(dsn=url, min_size=1, max_size=4)
    async with pool.acquire() as conn:
        await conn.execute('DROP SCHEMA IF EXISTS "nda_auth" CASCADE')
    try:
        yield pool
    finally:
        await pool.close()


@pytest_asyncio.fixture
async def store(pool):
    s = AuthStore(pool, pepper=PEPPER, cache_ttl=5.0, neg_ttl=2.0)
    await s.init_schema()
    return s
