
-- Migração 1: Adicionar coluna status em pipeline_stages
-- Passo 1: Adicionar com DEFAULT para não quebrar registros existentes
ALTER TABLE crm.pipeline_stages
  ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'Aberto'
  CHECK (status IN ('Aberto', 'Ganho', 'Perdido'));

-- Passo 2: Popular com base nos nomes já existentes
UPDATE crm.pipeline_stages
  SET status = 'Ganho'
  WHERE LOWER(name) IN ('fechado', 'ganho', 'sucesso', 'won', 'closed');

UPDATE crm.pipeline_stages
  SET status = 'Perdido'
  WHERE LOWER(name) IN ('perdido', 'lost', 'cancelado', 'descartado');

-- Passo 3: Garantir posições únicas por aces_id (fix positions que estão todas em 0)
-- Reordena usando row_number para evitar conflitos futuros
WITH ranked AS (
  SELECT id, aces_id, name,
    ROW_NUMBER() OVER (PARTITION BY aces_id ORDER BY created_at, id) - 1 AS new_position
  FROM crm.pipeline_stages
)
UPDATE crm.pipeline_stages ps
  SET position = ranked.new_position
FROM ranked
WHERE ps.id = ranked.id;
;
