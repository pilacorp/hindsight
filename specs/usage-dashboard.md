# Public team usage dashboard

Feature issue: https://github.com/pilacorp/hindsight/issues/23
Issue updated at: 2026-10-28T04:18:39Z
Issue body SHA-256: d5337f1e5c6756378eafc4480914e73efa282a24c824de351de516776ca609a5
Consulted source revisions: `nda/v1.0.0` at `8b84744661158123d38c0b5c4e4971b914c837dd`
Spec branch: `spec/usage-dashboard`

## Summary

Anyone can open a public page, with no sign-in, and see how this team uses the memory system. The page shows one team total and one row per current team member. Usage is activity and stored footprint over time. The page does not publish memory content.

This deployment already isolates each Supabase user in a `user_<uuid>` schema, and the control plane already signs members in. Nothing records a durable, content-free usage history that a public page can read. Prometheus `/metrics` is an operator scrape target, and bank and tenant labels are off by default. `audit_log` and `llm_requests` can store request and response bodies, and audit logging is off by default. `list_tenants()` only returns schemas the current process has initialized. None of those are the source for this page.

The spec adds a small usage ledger and a public read of that ledger. It does not add quotas, billing, or a private usage page.

## Setup and daily use

No new sign-in and no browser credential. After deployment:

- The public page is `/usage` on the control plane (locale stays out of the URL, matching the existing control plane).
- The login page links to it as "Team usage" so a visitor can find it without an account.
- `deploy/hindsight/README.md` lists the same URL next to the existing dashboard URL.
- Team membership continues to come from Supabase Auth. Creating or deleting an account stays in Supabase Studio. This page does not create accounts.

The API database role needs `SELECT` on `auth.users` columns `id` and `email` only. Document that grant in the deployment README. Do not give the control plane a database URL or a service-role key. The existing control-plane rule against `HINDSIGHT_CP_DATAPLANE_API_KEY` stays in force.

## Outcome and boundaries

Task classification: behavior change

A visitor who is not signed in opens `/usage` and sees team usage for today, the last 7 UTC days, and the last 30 UTC days. The default range is 7 days. Each range shows:

- Activity: successful and failed retain, recall, and reflect counts.
- Tokens: input, output, and cached input, including tokens used by that member's consolidation.
- Stored footprint: current counts of banks, documents, and memory units.
- A daily series for the selected range so usage can be read over time.

The team total is the sum of the listed members. A member with no activity still appears, with zeros.

A team member is a current row in `auth.users`. The public label is that account's email. Banned accounts stay listed. Deleted accounts are gone from `auth.users`, so they disappear from the list and from the totals. Their memory schema is not dropped by this work; that boundary from issue #3 stays.

Client disconnects are not successes and not failures. They are omitted, matching the existing operation metrics.

Scope is the NDA Supabase-tenant deployment (`hindsight_ext_supabase_tenant`). When that extension is not active, `GET /v1/default/usage/team` returns 404 and `/usage` says team usage is not enabled. Upstream single-tenant mode is unchanged.

Out of scope:

- Quotas, rate limits, billing, and invoices.
- A signed-in personal page, or hiding this page behind an operator login.
- Publishing memory text, prompts, document bodies, bank names, or account fields other than email.
- Backfilling history from `audit_log`, `llm_requests`, `async_operations`, or Prometheus.
- Enabling `HINDSIGHT_API_METRICS_INCLUDE_TENANT` or `HINDSIGHT_API_AUDIT_LOG_ENABLED`.
- Account administration and memory-schema deletion.

## Implementation

### Ledger

Create one shared schema, `hindsight_usage`, owned by the API database role. Do not create this table inside each `user_<uuid>` schema, and do not add it through the per-tenant migration copy.

`hindsight_usage.daily` has one row per user per UTC day:

| Column | Meaning |
| --- | --- |
| `user_id` | Supabase user UUID |
| `day` | UTC date |
| `retain_success`, `retain_failure` | Terminal retain results |
| `recall_success`, `recall_failure` | Terminal recall results |
| `reflect_success`, `reflect_failure` | Terminal reflect results |
| `input_tokens`, `output_tokens`, `cached_input_tokens` | Token totals for that user's LLM calls, including consolidation |
| `banks`, `documents`, `memory_units` | Latest footprint snapshot for that day; null until the first snapshot |
| `updated_at` | Last write |

Primary key: `(user_id, day)`.

When retain, recall, or reflect reaches a terminal result for a resolved Supabase tenant, increment that user's UTC-day counters. Resolve the user id from the tenant schema (`user_<uuid>` with hyphens restored). A usage-write failure is logged and does not change the memory operation's result. Prefer writing the counter in the same database transaction as the operation result when that result already commits. If the process dies after the operation commits and before the counter increments, that event can be missing. Do not reconstruct it from payload tables.

When an LLM call reports token usage for a resolved tenant, add those tokens to the same daily row. This includes consolidation. Do not add a consolidation count to the activity totals.

A worker maintenance pass snapshots footprint at least once per UTC day, and may run hourly. For each current `auth.users` row that has a schema, count `banks`, `documents`, and `memory_units` in that schema and store the counts on today's row. A user with no schema stores zeros. The public read uses these snapshots. It does not scan every tenant schema on the request. Footprint can lag until the next snapshot. The page shows the snapshot time.

Days before the ledger exists stay zero. Do not backfill.

### Public read

`GET /v1/default/usage/team?range=today|7d|30d`

- No `Authorization` header.
- Missing or unknown `range` is 400. The default when `range` is omitted is `7d`.
- `today` is the current UTC date. `7d` is that date and the previous 6. `30d` is that date and the previous 29.
- The handler reads `hindsight_usage.daily` and `auth.users (id, email)` only.
- It returns team totals, one object per current user, and a daily series of activity counts and token totals. Footprint on the response is the latest non-null snapshot in the range.
- Sort members by email.
- The response schema has no field for memory text, prompts, bank ids, document ids, user ids, or raw metadata.
- There is no query parameter for a user, schema, or bank. Callers cannot ask for one member's private data or for another deployment.

The control plane adds `GET /api/usage/team` to the public API allow-list in `hindsight-control-plane/src/middleware.ts`. That route proxies to the API usage endpoint and does not attach a bearer token. A 401 from any other `/api` route still redirects to login. `/usage` is excluded from `isMemoryArea`, so it does not mount bank providers or call authenticated memory APIs.

The page renders the team total, the member rows, the series, and the range control. It shows an error state when the usage endpoint is unavailable, and the not-enabled state on 404. It never renders memory content.

`/metrics`, the banks dashboard, and tenant isolation stay as they are.

## Acceptance mapping

| ID | Issue criterion | Expected behavior |
| --- | --- | --- |
| AC-01 | Anyone can open a public page with no sign-in | `/usage` and `GET /api/usage/team` work without a session |
| AC-02 | Show overall team usage | The page shows one team total for the selected range |
| AC-03 | Show each team member's usage | Every current `auth.users` row appears, including members with zeros |
| AC-04 | Usage means activity and stored footprint over time | Activity, tokens, footprint, and a daily series are visible for today, 7 days, and 30 days |
| AC-05 | Do not publish memory content | Responses and the page contain counts and emails only |

## Concrete test cases

These are planned tests. None have been executed for this spec.

| ID | Setup/input | Action | Expected result | Layer / acceptance IDs |
| --- | --- | --- | --- | --- |
| TC-01 | Two `daily` rows for one user inside a 7-day window | Aggregate the range | Success, failure, and token columns sum; days outside the window are excluded | unit; AC-02, AC-04 |
| TC-02 | A ledger row whose `user_id` is not in `auth.users` | Build the public view | That row is absent from members and from the team total | unit; AC-02, AC-03 |
| TC-03 | A current user with no ledger rows | Build the public view | The member is listed by email with zero activity, tokens, and footprint | unit; AC-03 |
| TC-04 | A retain cancelled by client disconnect | Record the terminal result | No success or failure counter changes | unit; AC-04 |
| TC-05 | Supabase tenant extension active, two users with different counts | `GET /v1/default/usage/team?range=7d` with no Authorization | 200; each email has only its own counts; the JSON has no memory text, bank id, or user id | API; AC-01, AC-03, AC-05 |
| TC-06 | Same server | `GET /v1/default/usage/team?range=year` | 400 | API; AC-04 |
| TC-07 | Extension not active | `GET /v1/default/usage/team` | 404 | API; AC-01 |
| TC-08 | Control plane middleware | `GET /api/usage/team` with no Authorization, and `GET /api/banks` with no Authorization | Usage is not rejected as unauthorized; banks still return 401 | control-plane unit; AC-01 |
| TC-09 | Browser, signed out | Open `/usage`, switch among today, 7 days, and 30 days | The page stays on `/usage`, shows totals and member rows, and does not redirect to `/login` | manual; AC-01, AC-02, AC-03 |

Failure cases: a database error on the public read returns an error page and no partial member content. A failed counter write does not fail the memory operation. A user with a null email is omitted from the public list rather than shown with an empty label, and their counts are omitted from the team total; record that omission in the server log.

## Hook changes

None.

## Documentation and rollout/recovery

Update `deploy/hindsight/README.md` with `/usage`, the `auth.users` grant, and the statement that the page publishes account emails plus usage counts.

Rollout is safe for existing memories: the ledger starts empty, and memory reads and writes keep their current behavior. Rollback is to stop serving `/usage` and `/v1/default/usage/team` and to stop the counter and snapshot writes. Leave `hindsight_usage` in place. Do not drop user schemas.

Manual QA is TC-09, plus a check that a signed-in bank page still loads and that two members' banks remain isolated.

## Decisions and risks

Decisions:

- Activity is retain, recall, and reflect. Consolidation tokens count toward the member, but consolidation is not a fourth activity.
- The public label is the account email.
- Ranges are UTC calendar days: today, 7 days, and 30 days.
- Team totals include only current Auth users, so the rows add up to the total.
- The ledger is the only source. Payload tables are not read.

Risks:

- A crash between an operation commit and the counter write can undercount. The page does not repair that gap.
- Footprint lags until the snapshot pass runs.
- The public API publishes team emails and usage counts to anyone who can reach the control plane or the API. That is the requested behavior. The route must stay limited to the response above.
- History from before the ledger exists is not shown.

## Review and implementation handoff

Spec PR: unset
Review reference: unset until reviewed
Merge reference/revision: unset until merged
Local spec matches merged reviewed version: not yet; this file is the draft on `spec/usage-dashboard`
Next action: human review of this spec. Do not implement from this draft.

The issue owns intent. This document does not grant approval; behavior-change implementation requires verified review/merge and matching local content.
