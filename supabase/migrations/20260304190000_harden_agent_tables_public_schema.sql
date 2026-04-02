BEGIN;
UPDATE public.agent_tables
SET schema_name = regexp_replace(schema_name, '^external\.', '', 'i')
WHERE schema_name ~* '^external\.';
UPDATE public.agent_tables
SET schema_name = 'public'
WHERE lower(trim(schema_name)) = 'public';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.agent_tables
    WHERE lower(trim(schema_name)) <> 'public'
  ) THEN
    RAISE EXCEPTION 'Existem registros em agent_tables com schema_name fora de public.';
  END IF;
END;
$$;
ALTER TABLE public.agent_tables
DROP CONSTRAINT IF EXISTS agent_tables_public_schema_only;
ALTER TABLE public.agent_tables
ADD CONSTRAINT agent_tables_public_schema_only
CHECK (schema_name = 'public');
COMMIT;
