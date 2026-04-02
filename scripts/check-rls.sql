-- Fails when any critical table has RLS disabled or not forced.
WITH audit AS (
  SELECT *
  FROM public.security_rls_audit()
),
violations AS (
  SELECT *
  FROM audit
  WHERE rls_enabled IS NOT TRUE
     OR rls_forced IS NOT TRUE
)
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM violations) THEN
      pg_catalog.set_config('security.rls_audit_failure', '1', false)
    ELSE
      pg_catalog.set_config('security.rls_audit_failure', '0', false)
  END;

DO $$
BEGIN
  IF current_setting('security.rls_audit_failure') = '1' THEN
    RAISE EXCEPTION 'RLS audit failed. Run SELECT * FROM public.security_rls_audit();';
  END IF;
END $$;

