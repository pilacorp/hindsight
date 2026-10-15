# NDA multi-user extension

A database-backed tenant extension plus an HTTP management extension that turn
Hindsight into a self-hosted multi-user service: each developer gets their own
API key and an isolated PostgreSQL schema, and an admin manages users and keys
— all without restarting the service and without an identity provider.

Built for [pilacorp/nda-harness#3](https://github.com/pilacorp/nda-harness/issues/3).
Ships by copying `nda_hindsight_multiuser/` into an image derived from Hindsight
(see the `Dockerfile`); the Hindsight API core is not modified.

## Parts

| Module | Role |
| --- | --- |
| `keys.py` | `ndak_<prefix>_<secret>` format, generation, HMAC-SHA256 peppered hashing (shown once, stored hashed). |
| `store.py` | The `nda_auth` schema (idempotent DDL): users, api_keys, audit. User CRUD, per-user keys, soft-delete, a short-TTL auth cache. |
| `tenant.py` | `NdaTenantExtension`: authenticates REST/MCP; user key → `u_<handle>` schema; admin key → 401; provisions schemas; `list_tenants`. |
| `http.py` | `NdaHttpExtension`: admin/user management under `/ext/nda/v1`. |
| `cli.py` | `create-admin` bootstraps the first admin key. |

## Configure

```bash
HINDSIGHT_API_TENANT_EXTENSION=nda_hindsight_multiuser.tenant:NdaTenantExtension
HINDSIGHT_API_HTTP_EXTENSION=nda_hindsight_multiuser.http:NdaHttpExtension
HINDSIGHT_API_TENANT_KEY_PEPPER=<server-side secret>   # required
HINDSIGHT_API_DATABASE_URL=postgresql://...
```

`HINDSIGHT_API_MCP_AUTH_TOKEN` and `HINDSIGHT_API_TENANT_MCP_AUTH_DISABLED` are
rejected at startup — either would let a caller reach memory without a per-user
key.

## Semantics

- A user may hold several active keys; generating one never replaces another;
  revoking one leaves the others working.
- **Disable** a user: all their keys are blocked and background processing
  pauses; **enable** restores both.
- **Delete** a user: all keys revoked, user removed from the list, handle kept
  reserved — but the schema and memories are **retained** (a database-owner
  action, outside this extension).
- Admin keys manage users and keys only; they never reach memory (401 on
  `/v1/*` and `/mcp`).

## Develop

```bash
uv sync
# needs a throwaway PostgreSQL for the store/tenant/http tests:
NDA_TEST_DATABASE_URL=postgresql://... uv run pytest -q
```

## License

MIT (matches the Hindsight extensions registry).
