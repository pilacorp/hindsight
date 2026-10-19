# Enable optional Supabase Studio for account management

Issue: https://github.com/pilacorp/hindsight/issues/3

## Context

The self-hosted Hindsight deployment needs a browser interface for infrastructure administrators to manage Supabase Auth accounts. Today, creating accounts requires calling the GoTrue Admin API manually.

Enable optional Supabase Studio rather than building a separate user-management page in Hindsight. Supabase remains the source of identity.

## Verified current state

Reviewed on 2026-10-19:
- `deploy/supabase/docker-compose.yaml` runs only Postgres, GoTrue Auth, and nginx; Studio and postgres-meta are omitted.
- `deploy/supabase/volumes/api/nginx.conf` routes `/auth/v1/*` to GoTrue.
- `deploy/supabase/README.md` documents account creation through the Auth Admin API.
- `deploy/hindsight/README.md` assigns user management to Supabase.
- The Hindsight dashboard supports email/password sign-in.
- `hindsight-extensions/supabase-tenant/hindsight_ext_supabase_tenant/extension.py` maps each authenticated UUID to a separate `user_<uuid>` PostgreSQL schema, initialized on first access.

## Proposed change

1. Add an opt-in Compose override under `deploy/supabase/` for Studio and the supporting services required by the pinned Studio version, including postgres-meta.
2. Connect Studio to the existing Auth service and database. Add the necessary gateway routes without replacing or resetting existing data.
3. Keep the default three-service deployment minimal. Do not enable Storage, Realtime, Edge Functions, or other unrelated services just to provide account management.
4. Restrict Studio to infrastructure administrators: bind its entry point to loopback by default and protect it with dashboard authentication. Document access through an authenticated internal proxy or VPN.
5. Keep database credentials and the Auth admin key server-side, separate from Hindsight browser configuration. Document required environment variables with placeholders.
6. Document start/stop commands, account creation, listing, updates, ban/unban, deletion, and the limits of email-dependent workflows. The current local stack has no SMTP, so invitation and password-recovery email flows need SMTP configuration.

Use compatible, pinned image versions and validate which account operations the selected self-hosted Studio version supports.

### Implementation decisions

- Use `deploy/supabase/docker-compose.studio.yaml` as an explicit override, adding `studio`, `meta`, and `studio-gateway` services.
- Publish only `studio-gateway` on `127.0.0.1:8001` by default. Require HTTP Basic authentication for every Studio page and API route, using a locally generated, Git-ignored htpasswd file. Publish neither Studio nor postgres-meta directly.
- Keep the existing Auth gateway and its `/auth/v1/*` routing unchanged. Studio uses it internally for Auth Admin API calls; postgres-meta connects to the existing database internally.
- Pin Studio and postgres-meta versions together from the upstream Compose configuration, then validate them against the existing Postgres and GoTrue versions.
- Provide a repeatable local smoke test for access protection and account lifecycle operations, plus browser verification of account management. Validate Hindsight sign-in and two-user bank isolation against the running deployment.
- Roll back by stopping the three optional services with the combined Compose files, then starting the original Compose file. Never remove database volumes.

## Account lifecycle boundaries

- Deleting an Auth account must not silently drop its Hindsight memory schema. Document that account deletion and memory-data purge are separate operations.
- Do not promise immediate access revocation from a ban or deletion. Hindsight's JWKS verification path validates JWTs locally without checking account/session state on every request. Verify and document behavior for the deployed authentication mode and existing tokens.
- Leave implementation of memory purge and stricter immediate-revocation enforcement to separate work.

## Acceptance criteria

1. The documented default Compose command still starts only Postgres, Auth, and nginx.
2. The documented opt-in command starts Studio and its required dependencies against the existing database, without volume reset or data loss.
3. An administrator can list users, create an email/password account, update account details, ban/unban, and delete an account through Studio.
4. A Studio-created account can sign in to Hindsight and access its own memory banks; two accounts remain isolated.
5. Studio is protected by dashboard authentication and its published entry point binds to loopback by default.
6. No privileged key or database credential is added to browser configuration or committed files.
7. Documentation explains SMTP requirements, memory-schema retention after account deletion, and tested token behavior after ban/deletion.
8. Removing the optional Studio services leaves existing Auth, Hindsight login, and stored memories operational.

## Validation and rollback

Validate Compose configuration for both modes, service health, authenticated Studio access, account-management operations, and Hindsight login/isolation using disposable test accounts. Record the behavior of an already-issued token after banning and deleting a disposable user.

Rollback by stopping the optional services and starting the original minimal stack without removing volumes.

## Out of scope

- A Hindsight user-management page or new application admin-role model.
- Supabase Cloud migration or enabling the full Supabase product stack.
- Automated memory-schema deletion, tenant quotas, or cross-user memory administration.
- SMTP deployment or implementing immediate token revocation.

## References

- [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting/docker)
- [Upstream Docker configuration](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml)
- [Supabase user management](https://supabase.com/docs/guides/auth/managing-user-data)
