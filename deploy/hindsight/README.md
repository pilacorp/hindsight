# NDA multi-user Hindsight — deployment

Runs the two custom images built from this repo (`hindsight-api-nda` with the
`nda_hindsight_multiuser` extensions, and `hindsight-cp-nda`, the forked Control
Plane) against an **external** PostgreSQL/pgvector. Per-developer API keys, one
isolated schema per user, admin-managed users and keys. For
[pilacorp/nda-harness#3](https://github.com/pilacorp/nda-harness/issues/3).

## Build the images

```bash
# from the repo root
docker build -f hindsight-extensions/nda-multiuser/Dockerfile \
  --build-arg HINDSIGHT_IMAGE=ghcr.io/vectorize-io/hindsight-api:1.0.0-slim \
  -t hindsight-api-nda:dev .
docker build -f docker/standalone/Dockerfile --target cp-only -t hindsight-cp-nda:dev .
```

## Configure and start

```bash
cd deploy/hindsight
cp .env.example .env           # fill in DATABASE_URL, LLM key, and the two secrets
# generate the two secrets:
#   openssl rand -hex 32   -> HINDSIGHT_API_TENANT_KEY_PEPPER
#   openssl rand -hex 32   -> HINDSIGHT_CP_SESSION_SECRET
docker compose up -d
```

The external PostgreSQL needs `CREATE EXTENSION vector` and a role that may
create schemas (one `u_<handle>` schema is created per user at runtime).

## Bootstrap the first admin key

```bash
docker compose exec api /app/api/.venv/bin/python -m nda_hindsight_multiuser.cli \
  create-admin --name ops
```

Store the printed key; it is shown once. Log in to the dashboard with it to
create users and issue their keys.

## Use

| Surface | URL |
| --- | --- |
| Dashboard | `http://127.0.0.1:9991` — login with an admin key (manage users/keys) or a user key (own memory) |
| REST API | `http://127.0.0.1:8891/v1/default/banks/...` with `Authorization: Bearer <key>` |
| MCP | `http://127.0.0.1:8891/mcp/<bank>/` with `Authorization: Bearer <user key>` |
| Management API | `http://127.0.0.1:8891/ext/nda/v1/admin/*` (admin key) |

- An **admin key** manages users and keys only; it is rejected from memory
  (`/v1`, `/mcp` → 401).
- A **user key** has its own schema; it creates banks and stores memory, and
  never sees another user's banks.
- Rotation: issue a new key, switch, revoke the old (multiple keys per user).
  Disable blocks all of a user's keys; delete revokes them and reserves the
  handle while retaining the schema (data deletion is a database-owner action).

## Notes

- Credentials live in `.env` (Git-ignored), read inside the containers.
- This stack defines no database service; point `HINDSIGHT_API_DATABASE_URL` at
  the managed PostgreSQL, or run one separately.
- Put the internal TLS reverse proxy in front of both ports; this stack binds
  loopback and terminates no TLS.
