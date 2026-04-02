
-- Migração 2: Atualizar trigger sync_status_and_stage com nova lógica
CREATE OR REPLACE FUNCTION crm.sync_status_and_stage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    found_stage_id UUID;
    found_stage_name TEXT;
BEGIN
    -- CASO 1: O sistema ou n8n atualizou o TEXTO "status" (mas não o stage_id)
    IF (NEW.status IS DISTINCT FROM OLD.status) AND (NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id) THEN

        -- Cenário A: Texto indica "Ganho" (diversos aliases)
        IF LOWER(NEW.status::TEXT) IN ('ganho', 'fechado', 'sucesso', 'won', 'closed') THEN
            SELECT id INTO found_stage_id
            FROM crm.pipeline_stages
            WHERE aces_id = NEW.aces_id AND status = 'Ganho'
            LIMIT 1;

        -- Cenário A: Texto indica "Perdido"
        ELSIF LOWER(NEW.status::TEXT) IN ('perdido', 'lost', 'cancelado', 'descartado') THEN
            SELECT id INTO found_stage_id
            FROM crm.pipeline_stages
            WHERE aces_id = NEW.aces_id AND status = 'Perdido'
            LIMIT 1;

        -- Cenário B: Texto é o nome de uma etapa intermediária (Aberto)
        ELSE
            SELECT id INTO found_stage_id
            FROM crm.pipeline_stages
            WHERE aces_id = NEW.aces_id
              AND status = 'Aberto'
              AND name ILIKE NEW.status::TEXT
            LIMIT 1;

            -- Fallback: se não encontrou, pega a 1ª etapa Aberta (menor position)
            IF found_stage_id IS NULL THEN
                SELECT id INTO found_stage_id
                FROM crm.pipeline_stages
                WHERE aces_id = NEW.aces_id AND status = 'Aberto'
                ORDER BY position ASC
                LIMIT 1;
            END IF;
        END IF;

        -- Aplica o stage_id encontrado
        IF found_stage_id IS NOT NULL THEN
            NEW.stage_id := found_stage_id;
        END IF;

    END IF;

    -- CASO 2: O Frontend (Kanban) atualizou o stage_id (via rpc_move_lead_to_stage)
    IF (NEW.stage_id IS DISTINCT FROM OLD.stage_id) THEN
        SELECT name INTO found_stage_name
        FROM crm.pipeline_stages
        WHERE id = NEW.stage_id
        LIMIT 1;

        IF found_stage_name IS NOT NULL THEN
            NEW.status := found_stage_name::crm.lead_status;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
;
