# Self-hosted Supabase (local dev) for NDA Hindsight

A minimal open-source Supabase stack — **Postgres + GoTrue Auth + an nginx
gateway** — that provides the two things Hindsight (#10) needs: an identity
provider (Supabase Auth + JWTs) and the Postgres database Hindsight runs on.
Dropped from the full upstream stack: PostgREST, Realtime, Storage, Studio,
pooler, Edge Functions — Hindsight uses none of them.

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

## Stop / reset

```bash
docker compose down            # keep data
docker compose down -v         # wipe the database (fresh start)
```
