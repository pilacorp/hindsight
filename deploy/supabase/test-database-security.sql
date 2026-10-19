-- Run only in an empty disposable database as postgres; see README.
\set ON_ERROR_STOP on

DO $$
BEGIN
    IF current_database() NOT LIKE 'hindsight_security_test%' OR
       EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public') THEN
        RAISE EXCEPTION 'Use a new empty hindsight_security_test database, never an application database';
    END IF;
END;
$$;

CREATE TABLE public.security_existing (id bigint GENERATED ALWAYS AS IDENTITY, payload text);
GRANT ALL ON public.security_existing TO anon, authenticated;
GRANT ALL ON SEQUENCE public.security_existing_id_seq TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;

-- Applying twice must be safe, including on an already protected database.
\ir volumes/db/hindsight-security.sql
\ir volumes/db/hindsight-security.sql

BEGIN;
CREATE TABLE public.security_future (id bigint GENERATED ALWAYS AS IDENTITY, payload text);
CREATE TABLE public.security_ctas AS SELECT 1 AS id;
SELECT 1 AS id INTO public.security_select_into;
CREATE TABLE public.security_partitioned (id int) PARTITION BY RANGE (id);
CREATE TABLE public.security_partition PARTITION OF public.security_partitioned FOR VALUES FROM (0) TO (10);
GRANT CREATE, USAGE ON SCHEMA public TO supabase_admin;
SET LOCAL ROLE supabase_admin;
CREATE TABLE public.security_admin (id bigint GENERATED ALWAYS AS IDENTITY);
RESET ROLE;

CREATE SCHEMA security_tenant;
CREATE TABLE security_tenant.untouched (id int);
INSERT INTO public.security_future (payload) VALUES ('backend access');

DO $$
DECLARE
    target record;
    client text;
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity) THEN
        RAISE EXCEPTION 'Existing or future public table is missing RLS';
    END IF;
    FOR target IN SELECT oid, relkind FROM pg_class WHERE relnamespace = 'public'::regnamespace
    LOOP
        FOREACH client IN ARRAY ARRAY['anon', 'authenticated']
        LOOP
            IF target.relkind IN ('r', 'p') AND
               has_table_privilege(client, target.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
                RAISE EXCEPTION 'Client % retains table privileges on %', client, target.oid::regclass;
            ELSIF target.relkind = 'S' AND has_sequence_privilege(client, target.oid, 'USAGE,SELECT,UPDATE') THEN
                RAISE EXCEPTION 'Client % retains sequence privileges on %', client, target.oid::regclass;
            END IF;
        END LOOP;
    END LOOP;
    IF (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'security_tenant' AND tablename = 'untouched') THEN
        RAISE EXCEPTION 'Policy touched a tenant schema';
    END IF;
    IF (SELECT count(*) FROM public.security_future) <> 1 THEN
        RAISE EXCEPTION 'Backend cannot read/write its table';
    END IF;
END;
$$;

SET LOCAL ROLE anon;
DO $$
BEGIN
    BEGIN
        PERFORM 1 FROM public.security_future;
        RAISE EXCEPTION 'Anonymous read unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END;
$$;
RESET ROLE;

-- Even an accidental future SELECT grant must not bypass the RLS safeguard.
GRANT SELECT ON public.security_future TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
    IF (SELECT count(*) FROM public.security_future) <> 0 THEN
        RAISE EXCEPTION 'RLS leaked backend rows to a signed-in client';
    END IF;
END;
$$;
RESET ROLE;
ROLLBACK;
\echo 'PASS: existing/future RLS, grants, both creators, tenant isolation, backend access, client denial, idempotency'
