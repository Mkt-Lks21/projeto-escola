
-- Migração 4a: Habilitar RLS em pipeline_stages
ALTER TABLE crm.pipeline_stages ENABLE ROW LEVEL SECURITY;

-- Policy: leitura para usuários autenticados do mesmo aces_id
DROP POLICY IF EXISTS "pipeline_stages_select" ON crm.pipeline_stages;
CREATE POLICY "pipeline_stages_select"
  ON crm.pipeline_stages
  FOR SELECT
  TO authenticated
  USING (
    aces_id = (
      SELECT u.aces_id FROM crm.users u
      WHERE u.auth_user_id = auth.uid()
      LIMIT 1
    )
  );

-- Policy: insert para admin
DROP POLICY IF EXISTS "pipeline_stages_insert" ON crm.pipeline_stages;
CREATE POLICY "pipeline_stages_insert"
  ON crm.pipeline_stages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM crm.users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role = 'ADMIN'
        AND u.aces_id = pipeline_stages.aces_id
    )
  );

-- Policy: update para admin
DROP POLICY IF EXISTS "pipeline_stages_update" ON crm.pipeline_stages;
CREATE POLICY "pipeline_stages_update"
  ON crm.pipeline_stages
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM crm.users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role = 'ADMIN'
        AND u.aces_id = pipeline_stages.aces_id
    )
  );

-- Policy: delete para admin
DROP POLICY IF EXISTS "pipeline_stages_delete" ON crm.pipeline_stages;
CREATE POLICY "pipeline_stages_delete"
  ON crm.pipeline_stages
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM crm.users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role = 'ADMIN'
        AND u.aces_id = pipeline_stages.aces_id
    )
  );

-- Migração 4b: Sincronização inicial — popular stage_id nos leads existentes
-- que ainda não têm stage_id, usando a lógica do novo trigger
UPDATE crm.leads l
SET stage_id = (
  -- Ganho
  CASE
    WHEN LOWER(l.status::TEXT) IN ('ganho', 'fechado', 'sucesso', 'won', 'closed') THEN (
      SELECT id FROM crm.pipeline_stages
      WHERE aces_id = l.aces_id AND status = 'Ganho'
      ORDER BY position LIMIT 1
    )
    -- Perdido
    WHEN LOWER(l.status::TEXT) IN ('perdido', 'lost', 'cancelado', 'descartado') THEN (
      SELECT id FROM crm.pipeline_stages
      WHERE aces_id = l.aces_id AND status = 'Perdido'
      ORDER BY position LIMIT 1
    )
    -- Meio do funil: tenta pelo nome, fallback = 1ª etapa aberta
    ELSE COALESCE(
      (
        SELECT id FROM crm.pipeline_stages
        WHERE aces_id = l.aces_id
          AND status = 'Aberto'
          AND name ILIKE l.status::TEXT
        ORDER BY position LIMIT 1
      ),
      (
        SELECT id FROM crm.pipeline_stages
        WHERE aces_id = l.aces_id AND status = 'Aberto'
        ORDER BY position LIMIT 1
      )
    )
  END
)
WHERE l.stage_id IS NULL AND l.aces_id IS NOT NULL;
;
