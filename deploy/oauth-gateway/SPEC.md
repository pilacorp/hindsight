# OAuth gateway for MCP — spec (#10 addendum)

## Why

Issue #10 authenticates REST/MCP with a Supabase JWT sent as a static bearer.
That works, but a Supabase **access token expires in ~1h**, and a token pasted
into an MCP client's config does not refresh — so agent connections break
hourly. This gateway gives local agents a proper **MCP OAuth 2.1** connection
(approve once in a browser, auto-refresh after) **without changing the
`supabase-tenant` extension**: the token that reaches Hindsight is still a
Supabase-signed JWT the extension verifies.

## What it is NOT

- Not a change to Hindsight core or the `supabase-tenant` extension.
- Not a replacement for the dashboard sign-in (the dashboard keeps supabase-js
  client-side; it already refreshes).
- Not an identity store — Supabase remains the only identity source.

## Topology

```
local agent (MCP client)
   │  (1) MCP OAuth 2.1: discovery → DCR (RFC 7591) → /authorize (PKCE S256) → /token
   │  (2) MCP JSON-RPC over HTTP, Authorization: Bearer <gateway_token>
   ▼
oauth-gateway  ── login → Supabase Auth (password grant, server-side)
   │  holds {supabase_access, supabase_refresh} per OAuth session; refreshes them
   │  (3) proxy MCP → Hindsight, Authorization: Bearer <supabase_access_jwt>
   ▼
Hindsight + supabase-tenant (verify Supabase JWT — UNCHANGED) → schema user_<uuid>
```

The agent authenticates to the **gateway** (gateway-issued token). The gateway
authenticates to **Hindsight** with the stored Supabase JWT and refreshes it
before expiry. Hindsight only ever sees a Supabase JWT, so the extension is
untouched.

## Endpoints (gateway)

| Endpoint | Purpose |
| --- | --- |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 AS metadata |
| `GET /.well-known/oauth-protected-resource` | RFC 9728, points MCP clients here |
| `POST /register` | Dynamic Client Registration (RFC 7591) |
| `GET /authorize` | Auth-code + PKCE S256; shows a login form, submits to Supabase |
| `POST /token` | code→tokens and `grant_type=refresh_token` (proxies Supabase refresh) |
| `ALL /mcp/<bank>/` | Authenticated MCP proxy → Hindsight, injecting the Supabase bearer |

## Rules / invariants

1. **PKCE S256 required**; reject plain. Validate `redirect_uri` against the
   registered client. One-time, short-TTL auth codes.
2. The downstream call to Hindsight **always carries a Supabase access JWT**;
   the gateway refreshes it with the stored Supabase refresh token when near
   expiry, so a long-lived MCP session never sends an expired token.
3. **Secrets stay server-side**: Supabase service/anon keys, the gateway signing
   key, and stored refresh tokens never reach the client or logs.
4. No change to `HINDSIGHT_API_TENANT_*` or the extension. Hindsight remains
   reachable directly by the dashboard/REST with a Supabase JWT; only MCP agents
   go through the gateway.
5. Built with a maintained OAuth library (Authlib), not hand-rolled crypto.

## Acceptance

- An MCP client (Claude Code/Cursor/Codex) pointed at the gateway completes DCR
  + browser approval and connects with **no pasted token**.
- After the Supabase access token's 1h lifetime, the session keeps working
  (gateway refreshed it) — no manual re-auth.
- Two different Supabase users reach only their own `user_<uuid>` schema through
  the gateway, same as direct bearer.
- Supabase service key / refresh tokens absent from logs, `docker compose
  config`, and `docker inspect`.

## CLI impact (nda-harness, separate branch)

`nda-harness setup` ("Set up Hindsight memory?") no longer collects a Supabase
access token. It registers the **gateway MCP URL** in the agent config; the
agent performs OAuth on first use. `verify` checks the gateway's discovery
endpoint is reachable. This supersedes issue #10's static-token CLI step — the
issue/dev-spec must be reconciled to the OAuth flow.
