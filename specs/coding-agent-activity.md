# Coding agent activity on the Hindsight usage page

Feature issue: https://github.com/pilacorp/hindsight/issues/51
Issue updated at: 2026-11-09T08:23:04Z
Consulted checkout: `226a4cc27b2089e9e5c7b38c556d5e1af9311243`
Status: Design approved in chat on 2026-11-09. Client attribution verification and spec PR review and merge are pending.

## Outcome

Add a team-level **Coding agent activity** block to the public Control Plane `/usage` page. Show Cursor, Claude, and Codex in that order. Each row shows **MCP connections** and **Last seen** for the selected Today, 7 days, or 30 days range, using the dashboard's existing UTC calendar boundaries.

A connection is one successful, authenticated MCP `initialize` exchange in the NDA Supabase-tenant deployment. Reconnects count again. The metric measures connections observed by Hindsight. It does not estimate editor sessions, prompts, or time spent. A row with no matching events shows zero and **No activity recorded**.

## Attribution and persistence

- Observe a successful MCP initialize exchange at the server dispatch boundary where the validated initialization payload and authenticated tenant context are available. Use the request's `clientInfo.name`. Count the exchange once after the successful protocol response. Do not count GET probes, authentication failures, protocol errors, tool discovery, memory calls, or REST traffic. The signal works at initialization without retaining client metadata across requests.
- Normalize the name with trimming and case folding, then use an exact allowlist derived from sanitized initialization fixtures from the supported clients. Before spec approval, add the actual normalized names and source client versions for Cursor, Claude, and Codex. The repo's synthetic MCP fixtures establish the payload shape only. Missing or unrecognized names remain unattributed. Client-declared identity is advisory and never grants access.
- Add a companion daily ledger in the existing shared `hindsight_usage` schema, keyed by authenticated user ID, UTC day, and normalized client enum. Persist an atomic count and maximum UTC timestamp for recognized clients. Use the existing team usage eligibility rules, with no writes when the usage store is inactive. Preserve existing metering, and log sanitized counter-write failures without affecting the MCP response. No historical backfill.
- Expose a team-only `coding_agents` list in the existing team usage response. Each row contains the normalized client enum, count, and nullable UTC last-seen timestamp. Use the same current-member eligibility and range as existing team totals. Last seen is the maximum timestamp within the selected range. Exclude unattributed requests from the three rows. Do not expose raw client names, versions, headers, user identifiers, or a per-person client breakdown.

## Control Plane and rollout

Use the existing usage fetch and range selector. Display last-seen timestamps in the viewer's local time and show the existing empty/error behavior when the usage endpoint is unavailable. If an older API omits the new field, omit the block until the API is upgraded. Once the API returns it, show all three rows even with no history.

Create the companion ledger through the existing usage store schema initialization. Roll back by removing the writer and block while leaving accumulated rows in place. No hook, auth, or client configuration changes are part of this draft.

## Acceptance and verification

| ID | Scenario | Expected result |
| --- | --- | --- |
| AC-01 | Initialize using a fixture captured from each supported client | Successful authenticated exchanges map to the correct rows in both supported transport modes. |
| AC-02 | Probe, malformed initialization, rejected authentication, unknown client, and tool or REST calls | None increase a named client count. Existing memory usage totals remain unaffected. |
| AC-03 | Concurrent initializations and out-of-order timestamps | Successful exchanges are counted once each and the newest timestamp wins. A ledger write error leaves the MCP response intact. |
| AC-04 | Query the dashboard across UTC midnight and switch ranges | Counts and Last seen follow the selected range and team membership. Empty rows show zero and the empty label. |
| AC-05 | Inspect the public API and UI with mixed-client history | The payload contains only aggregate client counts and timestamps, and no raw identity, user mapping, or memory content. |
| AC-06 | Run the page against an older API and then an upgraded API with an empty ledger | The older response still renders the existing dashboard. The upgraded response shows three empty rows. |

Planned coverage includes MCP integration tests, ledger and aggregation tests, and Control Plane component tests. The three real-client fixtures and review and merge references are pending. Application tests have not run for this draft.
