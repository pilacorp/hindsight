# Self-hosted Supabase (local dev) for NDA Hindsight

A minimal open-source Supabase stack — **Postgres + GoTrue Auth + an nginx
gateway** — that provides the two things Hindsight (#10) needs: an identity
provider (Supabase Auth + JWTs) and the Postgres database Hindsight runs on.
Dropped from the default stack: PostgREST, Realtime, Storage, Studio,
pooler, Edge Functions. An optional Studio override below provides account
administration without enabling the other Supabase services.

> Local dev only. The keys in `.env.example` are Supabase's published **demo**
> HS256 keys. Regenerate everything for anything real.

## Start

```bash
cd deploy/supabase
cp .env.example .env
docker compose up -d
# gateway http://localhost:8000  (/auth/v1/* -> GoTrue)
# postgres localhost:54322
```

## Create a test user

No SMTP here, so sign-ups are auto-confirmed. Create users with the GoTrue admin
API (service key as bearer):

```bash
SERVICE_KEY=$(grep ^SERVICE_ROLE_KEY= .env | cut -d= -f2-)
curl -s -X POST http://localhost:8000/auth/v1/admin/users \
  -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" \
  -d '{"email":"dev@local.test","password":"devpass123","email_confirm":true}'
```

Get that user's access token (the JWT the dashboard/CLI send to Hindsight):

```bash
ANON_KEY=$(grep ^ANON_KEY= .env | cut -d= -f2-)
curl -s -X POST "http://localhost:8000/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"dev@local.test","password":"devpass123"}' | jq -r .access_token
```

## Wire it into Hindsight

In `deploy/hindsight/.env`, point Hindsight at this stack. These demo keys use
**HS256** (no JWKS), so the tenant extension needs the service key:

```ini
# Hindsight runs on Supabase's Postgres (role postgres = can create schemas):
HINDSIGHT_API_DATABASE_URL=postgresql://postgres:your-super-secret-and-long-postgres-password@host.docker.internal:54322/postgres

# Identity. Base URL without /auth/v1 — the extension appends it:
HINDSIGHT_API_TENANT_SUPABASE_URL=http://host.docker.internal:8000
# HS256 project -> service key required (JWKS preferred otherwise):
HINDSIGHT_API_TENANT_SUPABASE_SERVICE_KEY=<SERVICE_ROLE_KEY from this .env>

# Dashboard (browser) sign-in — build the CP image with these, see deploy/hindsight:
NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY from this .env>
```

`host.docker.internal` is how the Hindsight containers reach this stack on the
host; the browser uses `localhost`.

## Optional Studio account administration

Studio is for trusted infrastructure administrators. It includes a SQL Editor
and database administration, so dashboard access grants much more than account
management. Its HTTP Basic credentials are separate from Supabase user accounts.

From `deploy/supabase`, with the minimal stack configured:

1. Generate a postgres-meta encryption key with `openssl rand -hex 32` and set
   `PG_META_CRYPTO_KEY` in `.env`. Keep it stable across restarts.
2. Generate the Git-ignored password file (OpenSSL prompts for a new dashboard
   password; choose a unique, strong password):

   ```bash
   printf 'admin:%s\n' "$(openssl passwd -6)" > .studio.htpasswd
   chmod 644 .studio.htpasswd
   ```

   The file contains a salted hash, not the password. It must be readable by
   nginx's worker inside the container. Keep the parent directory private.

3. Start the optional services:

   ```bash
   docker compose -f docker-compose.yaml -f docker-compose.studio.yaml up -d --wait
   ```

Open `http://127.0.0.1:8001/project/default/auth/users` and authenticate as `admin`
with the dashboard password. `STUDIO_PUBLISH_PORT` changes the port. Studio and
postgres-meta are internal only; the authenticated nginx gateway is the only
published Studio entry point, bound to loopback. Every Studio page and API route
requires authentication, including its SQL API. The existing Auth gateway on
port 8000 is unchanged.

For remote access, use an SSH tunnel or a TLS reverse proxy on the host protected
by your organization's authentication/VPN. HTTP Basic over plain HTTP is for
loopback only. Do not publish Studio's port 3000 or postgres-meta's port 8080
directly. Treat this dashboard as database-admin access, including access to
project keys; keep its credentials and service key out of Hindsight's browser
configuration. The existing local-development limitations still apply.

### Manage accounts

- **List/search:** Authentication → Users.
- **Create:** Add user → Create new user; supply email/password and keep Auto
  confirm enabled for this local stack. The account can immediately sign in to
  Hindsight at `http://127.0.0.1:9991`.
- **Ban/unban:** select a user, choose Ban user and a duration; use Unban user to
  restore sign-in.
- **Delete:** select a disposable or retired user and choose Delete user.
- **Profile metadata:** this pinned self-hosted Users panel does not offer
  general email/password/profile editing. Use Studio's Table Editor
  (`auth.users`, `raw_user_meta_data`) or SQL Editor for profile metadata. Do not
  put permissions in this user-editable metadata. Use the Auth Admin API for
  email/password changes rather than directly editing Auth-managed fields.

Send invitation, password recovery, and magic-link actions need working SMTP.
This stack intentionally configures no SMTP; Studio does not supply a mail
server. Configure GoTrue's SMTP settings separately before using those actions.
Studio navigation also lists disabled Supabase products; those pages are not
supported by this minimal deployment. Auth provider configuration remains in
Compose/GoTrue environment variables, not the self-hosted dashboard.

### Account deletion and existing sessions

Deleting a Supabase Auth account **does not delete its Hindsight memory schema**
(`user_<uuid>`, with UUID hyphens replaced by underscores). Decide on retention
and backup before any separate memory-data purge. Studio does not implement a
Hindsight tenant lifecycle.

The smoke test reports how GoTrue `/auth/v1/user` responds to an already-issued
token after ban and deletion. Hindsight's HS256 mode checks that endpoint on each
request. Its asymmetric JWKS mode verifies tokens locally and does not check
account/session status on every request, so an existing token may remain usable
until expiry. A successful ban/delete in Studio is not a guarantee of immediate
revocation across all Hindsight authentication modes.

Verified locally on 2026-10-19 with the pinned GoTrue v2.196.0 and HS256 demo
configuration: an already-issued token received HTTP 403 from GoTrue `/user`
after both ban and account deletion; new password sign-in received HTTP 400.
Unbanning restored password sign-in (HTTP 200). Asymmetric JWKS mode was not
exercised by this local stack.

### Verify locally

Use Node.js 22+ and Docker Compose. The test creates two uniquely named accounts,
checks Basic authentication, exercises Studio account APIs and profile metadata
through its SQL API, checks sign-in/ban/unban/delete, and cleans up its accounts.
It prints status codes rather than passwords or tokens:

```bash
read -r -s -p 'Studio admin password: ' STUDIO_PASSWORD; echo
export STUDIO_PASSWORD
HINDSIGHT_URL=http://127.0.0.1:8891 node --env-file=.env test-studio.mjs
unset STUDIO_PASSWORD
```

Set `STUDIO_USERNAME` if the htpasswd username differs from `admin`.
`STUDIO_PASSWORD_FILE` can point to an owner-readable local password file instead
of setting `STUDIO_PASSWORD`. Omitting `HINDSIGHT_URL` skips bank isolation and
schema-retention checks. With it set, the test creates/deletes an empty bank,
proves a second user cannot list it, and checks that the first user's schema
survives account deletion. Empty tenant schemas are retained intentionally.

Also verify the browser flow: create a user in Studio, open its detail panel,
ban/unban it, sign in to Hindsight, and delete the disposable account when done.

### Stop Studio / rollback

```bash
docker compose -f docker-compose.yaml -f docker-compose.studio.yaml stop studio-gateway studio meta
docker compose -f docker-compose.yaml -f docker-compose.studio.yaml rm -f studio-gateway studio meta
docker compose -f docker-compose.yaml up -d --wait
```

This removes only the three optional containers. Auth accounts, Hindsight
schemas, and the database volume remain. Run the combined `up` command to enable
Studio again. Do not use `down -v` for rollback.

## Stop / reset

```bash
docker compose down            # keep data
docker compose down -v         # wipe the database (fresh start)
```
