-- Dev-only: the supabase/postgres image creates auth.uid()/role()/email()
-- owned by `postgres`, but GoTrue connects as supabase_auth_admin and does
-- CREATE OR REPLACE on them during migration -> "must be owner of function uid".
-- Granting superuser lets supabase_auth_admin replace them, while keeping its
-- search_path=auth so GoTrue's unqualified table refs still resolve. Local dev
-- only; a real deployment uses the full upstream role/ownership setup.
ALTER ROLE supabase_auth_admin WITH SUPERUSER;
