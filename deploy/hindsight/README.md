# NDA Hindsight — Supabase-tenant deployment

Runs two images built from this repo — `hindsight-api-supabase` (the upstream
`hindsight_ext_supabase_tenant` extension) and `hindsight-cp-nda` (the forked
Control Plane with Supabase sign-in) — against a **self-hosted open-source
[Supabase](https://github.com/supabase/supabase)** stack (Auth + Postgres).
Supabase Cloud is not a target. Identity is the Supabase user; each user gets an
isolated `user_<uuid>` schema, provisioned on first authenticated access.
Hindsight issues and stores no keys. For
[pilacorp/nda-harness#10](https://github.com/pilacorp/nda-harness/issues/10),
replacing the API-key model of #3.

## Prerequisites

- A self-hosted Supabase stack running on internal infra (its Auth + its
  Postgres, which provides `vector`). Note its API URL, anon key, and Postgres URL.
- Hindsight runs **no** database of its own; `HINDSIGHT_API_DATABASE_URL` points
  at the Supabase Postgres, with a role that may create schemas.

## Build the images

```bash
# from the repo root. Build from the nda-oauth Dockerfile: it bundles BOTH the
# supabase-tenant extension (verifies the JWT) and the nda-oauth extension that
# the compose file wires up as HINDSIGHT_API_HTTP_EXTENSION. Building from the
# supabase-tenant Dockerfile omits nda-oauth, so the API would fail to start.
docker build -f hindsight-extensions/nda-oauth/Dockerfile \
  --build-arg HINDSIGHT_IMAGE=ghcr.io/vectorize-io/hindsight-api:1.0.0-slim \
  -t hindsight-api-supabase:dev .

# Control Plane. NEXT_PUBLIC_* are inlined by `next build`, so the browser
# Supabase client needs them at BUILD time (anon key is public by design):
docker build -f docker/standalone/Dockerfile --target cp-only \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=http://<internal-supabase-api> \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key> \
  -t hindsight-cp-nda:dev .
```

## Configure and start

```bash
cd deploy/hindsight
cp .env.example .env    # fill in DATABASE_URL, Supabase URL/anon key, LLM key
docker compose up -d
```

Prefer JWKS verification (leave `HINDSIGHT_API_TENANT_SUPABASE_SERVICE_KEY`
empty). Set the service key only for a legacy HS256 project or the startup
health check. Startup fails if the Supabase URL is missing, or if the project is
HS256 and no service key is set.

## Use

| Surface          | URL                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Dashboard        | `http://127.0.0.1:9991` — sign in with a Supabase email + password                                                            |
| Team usage       | `http://127.0.0.1:9991/usage` — public, no sign-in. Shows this team's memory usage and each member's email                     |
| REST API         | `http://127.0.0.1:8891/v1/default/banks/...` with `Authorization: Bearer <supabase_jwt>`                                      |
| MCP (multi-bank) | `http://127.0.0.1:8891/mcp/` with `Authorization: Bearer <supabase_jwt>`; pick the bank per call via the tools' `bank_id` arg |

- The dashboard, REST, MCP, and the CLI all authenticate with the **same**
  Supabase user, so they reach the same `user_<uuid>` schema. No Hindsight key.
- A new Supabase user needs no restart; their schema is created on first call.
- User management (create/disable/delete) is done in Supabase, not here. There
  is no Hindsight admin UI. For the local minimal stack, enable the optional
  [Supabase Studio account administration](../supabase/README.md#optional-studio-account-administration)
  dashboard; its administrator login is separate from Hindsight sign-in.
- Invitations and recovery emails open Hindsight's `/auth/set-password` page.
  Signed-in users can choose **Account → Change password** in the header or visit
  `/account/change-password`. Configure the SMTP relay and public app URL using
  the [Supabase deployment instructions](../supabase/README.md#smtp-and-password-flows).
- `/usage` is public. It publishes each current account's email plus usage counts
  (retain, recall, reflect, tokens, and stored footprint). It does not publish
  memory content. The API role needs `SELECT` on `auth.users (id, email)` only:

  ```sql
  GRANT SELECT (id, email) ON auth.users TO <hindsight_api_role>;
  ```

## Cutover from #3 and rollback

- This is a local-dev cutover: the old `u_<handle>` schemas and `nda_auth`
  key store from #3 are **not** reused as Supabase tenants and are never attached
  to a Supabase user. For a fresh local run, drop them.
- `list_tenants()` returns only schemas this process has already initialized;
  after a restart, a user's schema is consolidated again once they re-authenticate.
- Rollback = run the previous `hindsight-api-nda` image, restore
  `HINDSIGHT_API_TENANT_EXTENSION=nda_hindsight_multiuser.tenant:NdaTenantExtension`
  (+ pepper/HTTP extension), the API-key Control Plane image, and the previous
  database URL.

## Notes

- Credentials live in `.env` (Git-ignored), read inside the containers. The
  Supabase service-role key (if used) and the Postgres password stay server-side.
- The single API container runs the in-process worker, so the tenant settings
  cover consolidation too.
- Put the internal TLS reverse proxy in front of both ports; this stack binds
  loopback and terminates no TLS.
