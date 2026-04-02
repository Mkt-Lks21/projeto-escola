-- 1. Rename column status to category in pipeline_stages
ALTER TABLE crm.pipeline_stages RENAME COLUMN status TO category;

-- 2. Update the sync trigger function
CREATE OR REPLACE FUNCTION crm.sync_status_and_stage()
 RETURNS trigger
 LANGUAGE plpgsql
 AS $function$
DECLARE
    found_stage_id UUID;
    found_stage_name TEXT;
BEGIN
    -- CASE 1: n8n or system updated the TEXT "status" (but not the stage_id)
    IF (TG_OP = 'INSERT') OR ((NEW.status IS DISTINCT FROM OLD.status) AND (NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id)) THEN
        
        -- Priority 1: Exact name match (case insensitive)
        SELECT id INTO found_stage_id
        FROM crm.pipeline_stages
        WHERE aces_id = NEW.aces_id 
          AND LOWER(name) = LOWER(NEW.status::TEXT)
        LIMIT 1;

        -- Priority 2: Alias match for Win/Loss (Scenario A)
        IF found_stage_id IS NULL THEN
            IF LOWER(NEW.status::TEXT) IN ('ganho', 'fechado', 'sucesso', 'won', 'closed') THEN
                SELECT id INTO found_stage_id
                FROM crm.pipeline_stages
                WHERE aces_id = NEW.aces_id AND category = 'Ganho'
                ORDER BY position ASC
                LIMIT 1;
            ELSIF LOWER(NEW.status::TEXT) IN ('perdido', 'lost', 'cancelado', 'descartado') THEN
                SELECT id INTO found_stage_id
                FROM crm.pipeline_stages
                WHERE aces_id = NEW.aces_id AND category = 'Perdido'
                ORDER BY position ASC
                LIMIT 1;
            END IF;
        END IF;

        -- Fallback: If still not found, take the first 'Aberto' stage
        IF found_stage_id IS NULL THEN
            SELECT id INTO found_stage_id
            FROM crm.pipeline_stages
            WHERE aces_id = NEW.aces_id AND category = 'Aberto'
            ORDER BY position ASC
            LIMIT 1;
        END IF;

        -- Apply the found stage_id
        IF found_stage_id IS NOT NULL THEN
            NEW.stage_id := found_stage_id;
        END IF;
    END IF;

    -- CASE 2: Frontend (Kanban) updated the stage_id (via Drag & Drop)
    IF (NEW.stage_id IS DISTINCT FROM OLD.stage_id) THEN
        SELECT name INTO found_stage_name
        FROM crm.pipeline_stages
        WHERE id = NEW.stage_id
        LIMIT 1;

        IF found_stage_name IS NOT NULL THEN
            NEW.status := found_stage_name::character varying;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

-- 3. Update the default stages function to use 'category'
CREATE OR REPLACE FUNCTION crm.fn_create_default_pipeline_stages(p_aces_id integer)
RETURNS void AS $$
BEGIN
  -- Insert "Novo"
  IF NOT EXISTS (SELECT 1 FROM crm.pipeline_stages WHERE aces_id = p_aces_id AND name = 'Novo') THEN
    INSERT INTO crm.pipeline_stages (aces_id, name, color, category, position)
    VALUES (p_aces_id, 'Novo', '#3b82f6', 'Aberto', 1);
  END IF;

  -- Insert "Atendimento"
  IF NOT EXISTS (SELECT 1 FROM crm.pipeline_stages WHERE aces_id = p_aces_id AND name = 'Atendimento') THEN
    INSERT INTO crm.pipeline_stages (aces_id, name, color, category, position)
    VALUES (p_aces_id, 'Atendimento', '#f59e0b', 'Aberto', 2);
  END IF;

  -- Insert "Fechado"
  IF NOT EXISTS (SELECT 1 FROM crm.pipeline_stages WHERE aces_id = p_aces_id AND name = 'Fechado') THEN
    INSERT INTO crm.pipeline_stages (aces_id, name, color, category, position)
    VALUES (p_aces_id, 'Fechado', '#10b981', 'Ganho', 3);
  END IF;

  -- Insert "Perdido"
  IF NOT EXISTS (SELECT 1 FROM crm.pipeline_stages WHERE aces_id = p_aces_id AND name = 'Perdido') THEN
    INSERT INTO crm.pipeline_stages (aces_id, name, color, category, position)
    VALUES (p_aces_id, 'Perdido', '#ef4444', 'Perdido', 4);
  END IF;

  -- Insert "Remarketing"
  IF NOT EXISTS (SELECT 1 FROM crm.pipeline_stages WHERE aces_id = p_aces_id AND name = 'Remarketing') THEN
    INSERT INTO crm.pipeline_stages (aces_id, name, color, category, position)
    VALUES (p_aces_id, 'Remarketing', '#6366f1', 'Aberto', 5);
  END IF;
END;
$$ LANGUAGE plpgsql;;
