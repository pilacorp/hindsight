-- This deployment exposes Auth, not a Supabase Data API. Hindsight accesses
-- Postgres as its backend role; browser roles must not access its public tables.
BEGIN;
SET LOCAL lock_timeout = '5s';

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Supabase seeds these per-creator defaults; revoking current grants alone
-- would expose tables again after the next Hindsight migration.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
    REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
    REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
    target record;
BEGIN
    FOR target IN
        SELECT oid::regclass AS relation
        FROM pg_class
        WHERE relnamespace = 'public'::regnamespace
          AND relkind IN ('r', 'p') AND NOT relrowsecurity
        ORDER BY oid
    LOOP
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target.relation);
    END LOOP;
END;
$$;

-- Keep deployment helpers out of public (which Studio treats as API-exposed).
CREATE SCHEMA IF NOT EXISTS hindsight_deployment;
REVOKE ALL ON SCHEMA hindsight_deployment FROM PUBLIC, anon, authenticated;

-- supautils runs a superuser's event triggers only when its function has the
-- same owner. Install the same invoker-only rule for both table creators.
DO $install$
DECLARE
    creator text;
    hook_name text;
BEGIN
    FOREACH creator IN ARRAY ARRAY['postgres', 'supabase_admin']
    LOOP
        hook_name := 'hindsight_public_rls_' || creator;
        EXECUTE format($definition$
            CREATE OR REPLACE FUNCTION hindsight_deployment.%I()
            RETURNS event_trigger
            LANGUAGE plpgsql
            SET search_path = pg_catalog
            AS $body$
            DECLARE
                target record;
            BEGIN
                FOR target IN
                    SELECT DISTINCT c.oid::regclass AS relation
                    FROM pg_event_trigger_ddl_commands() AS ddl
                    JOIN pg_class AS c ON ddl.classid = 'pg_class'::regclass AND c.oid = ddl.objid
                    WHERE c.relnamespace = 'public'::regnamespace
                      AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
                LOOP
                    EXECUTE format('ALTER TABLE %%s ENABLE ROW LEVEL SECURITY', target.relation);
                END LOOP;
            END;
            $body$;
        $definition$, hook_name);
        EXECUTE format('ALTER FUNCTION hindsight_deployment.%I() OWNER TO %I', hook_name, creator);
        EXECUTE format('REVOKE ALL ON FUNCTION hindsight_deployment.%I() FROM PUBLIC, anon, authenticated', hook_name);
        IF NOT EXISTS (SELECT FROM pg_event_trigger WHERE evtname = hook_name) THEN
            -- CREATE-only tags avoid recursion from the ALTER TABLE above.
            EXECUTE format(
                'CREATE EVENT TRIGGER %I ON ddl_command_end '
                'WHEN TAG IN (''CREATE TABLE'', ''CREATE TABLE AS'', ''SELECT INTO'') '
                'EXECUTE FUNCTION hindsight_deployment.%I()', hook_name, hook_name
            );
            EXECUTE format('ALTER EVENT TRIGGER %I OWNER TO %I', hook_name, creator);
        END IF;
    END LOOP;
END;
$install$;

COMMIT;
