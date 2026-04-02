BEGIN;

-- Enforce RLS on all app tables used by client traffic.
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_usage_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.database_metadata_cache ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tables FORCE ROW LEVEL SECURITY;
ALTER TABLE public.llm_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.billing_usage_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.billing_usage_cycles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.database_metadata_cache FORCE ROW LEVEL SECURITY;

-- Remove legacy public metadata access.
DROP POLICY IF EXISTS "Allow public read on metadata cache" ON public.database_metadata_cache;
DROP POLICY IF EXISTS "Allow public insert on metadata cache" ON public.database_metadata_cache;
DROP POLICY IF EXISTS "Allow public delete on metadata cache" ON public.database_metadata_cache;

DROP POLICY IF EXISTS "Service role manages metadata cache" ON public.database_metadata_cache;
CREATE POLICY "Service role manages metadata cache"
  ON public.database_metadata_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Explicit deny-by-default for app roles.
DROP POLICY IF EXISTS "Authenticated users read metadata cache" ON public.database_metadata_cache;
CREATE POLICY "Authenticated users read metadata cache"
  ON public.database_metadata_cache
  FOR SELECT
  TO authenticated
  USING (false);

DROP POLICY IF EXISTS "Anon users read metadata cache" ON public.database_metadata_cache;
CREATE POLICY "Anon users read metadata cache"
  ON public.database_metadata_cache
  FOR SELECT
  TO anon
  USING (false);

-- CI helper: fail when critical tables are missing RLS/FORCE RLS.
CREATE OR REPLACE FUNCTION public.security_rls_audit()
RETURNS TABLE(
  schema_name text,
  table_name text,
  rls_enabled boolean,
  rls_forced boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    n.nspname::text AS schema_name,
    c.relname::text AS table_name,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS rls_forced
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND n.nspname = 'public'
    AND c.relname IN (
      'conversations',
      'messages',
      'agents',
      'agent_tables',
      'llm_settings',
      'user_profiles',
      'billing_usage_events',
      'billing_usage_cycles',
      'database_metadata_cache'
    )
  ORDER BY c.relname;
$$;

REVOKE ALL ON FUNCTION public.security_rls_audit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_rls_audit() TO service_role;

COMMIT;
