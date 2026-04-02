-- Function to insert default stages for a given aces_id
CREATE OR REPLACE FUNCTION crm.fn_create_default_pipeline_stages(p_aces_id integer)
RETURNS void AS $$
BEGIN
  -- Insert "Novo"
  IF NOT EXISTS (SELECT 1 FROM crm.pipeline_stages WHERE aces_id = p_aces_id AND name = 'Novo') THEN
    INSERT INTO crm.pipeline_stages (aces_id, name, color, status, position)
    VALUES (p_aces_id, 'Novo', '#3b82f6', 'Aberto', 1);
  END IF;

  -- Insert "Atendimento"
  IF NOT EXISTS (SELECT 1 FROM crm.pipeline_stages WHERE aces_id = p_aces_id AND name = 'Atendimento') THEN
    INSERT INTO crm.pipeline_stages (aces_id, name, color, status, position)
    VALUES (p_aces_id, 'Atendimento', '#f59e0b', 'Aberto', 2);
  END IF;

  -- Insert "Fechado"
  IF NOT EXISTS (SELECT 1 FROM crm.pipeline_stages WHERE aces_id = p_aces_id AND name = 'Fechado') THEN
    INSERT INTO crm.pipeline_stages (aces_id, name, color, status, position)
    VALUES (p_aces_id, 'Fechado', '#10b981', 'Ganho', 3);
  END IF;

  -- Insert "Perdido"
  IF NOT EXISTS (SELECT 1 FROM crm.pipeline_stages WHERE aces_id = p_aces_id AND name = 'Perdido') THEN
    INSERT INTO crm.pipeline_stages (aces_id, name, color, status, position)
    VALUES (p_aces_id, 'Perdido', '#ef4444', 'Perdido', 4);
  END IF;

  -- Insert "Remarketing"
  IF NOT EXISTS (SELECT 1 FROM crm.pipeline_stages WHERE aces_id = p_aces_id AND name = 'Remarketing') THEN
    INSERT INTO crm.pipeline_stages (aces_id, name, color, status, position)
    VALUES (p_aces_id, 'Remarketing', '#6366f1', 'Aberto', 5);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to handle new accounts
CREATE OR REPLACE FUNCTION crm.tr_fn_on_account_created()
RETURNS trigger AS $$
BEGIN
  PERFORM crm.fn_create_default_pipeline_stages(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger
DROP TRIGGER IF EXISTS tr_accounts_insert_pipeline_stages ON crm.accounts;
CREATE TRIGGER tr_accounts_insert_pipeline_stages
AFTER INSERT ON crm.accounts
FOR EACH ROW
EXECUTE FUNCTION crm.tr_fn_on_account_created();

-- Initial sync for all existing accounts
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM crm.accounts LOOP
    PERFORM crm.fn_create_default_pipeline_stages(r.id);
  END LOOP;
END;
$$;;
