"""Admin CLI, run inside the API container.

    python -m nda_hindsight_multiuser.cli create-admin --name ops

Bootstraps the first admin key without passing any secret through an
environment variable: it connects to the configured database, ensures the
auth schema, issues an admin key, and prints it **once**. Reads the database
URL from HINDSIGHT_API_DATABASE_URL and the pepper from
HINDSIGHT_API_TENANT_KEY_PEPPER.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

import asyncpg

from .store import AuthStore


async def _create_admin(name: str, label: str) -> int:
    url = os.environ.get("HINDSIGHT_API_DATABASE_URL")
    pepper = os.environ.get("HINDSIGHT_API_TENANT_KEY_PEPPER")
    if not url:
        print("HINDSIGHT_API_DATABASE_URL is not set", file=sys.stderr)
        return 2
    if not pepper:
        print("HINDSIGHT_API_TENANT_KEY_PEPPER is not set", file=sys.stderr)
        return 2
    pool = await asyncpg.create_pool(dsn=url, min_size=1, max_size=2)
    try:
        store = AuthStore(pool, pepper=pepper)
        await store.init_schema()
        issued, _ = await store.issue_admin_key(name, label, actor=f"cli:{name}")
    finally:
        await pool.close()
    print("Admin key created. Store it now; it is not shown again.")
    print(f"  name:  {name}")
    print(f"  key:   {issued.full}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="nda-hindsight-admin")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("create-admin", help="Issue the first admin key")
    p.add_argument("--name", required=True, help="Admin name recorded with the key")
    p.add_argument("--label", default="bootstrap", help="Key label")
    args = parser.parse_args(argv)
    if args.command == "create-admin":
        return asyncio.run(_create_admin(args.name, args.label))
    parser.error(f"unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
