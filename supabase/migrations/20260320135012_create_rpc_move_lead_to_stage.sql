
-- Migração 3: Nova RPC para o Kanban (Frontend envia UUID, não texto)
CREATE OR REPLACE FUNCTION crm.rpc_move_lead_to_stage(p_lead_id UUID, p_stage_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'crm', 'public', 'auth'
AS $$
DECLARE
  v_user_role crm.user_role;
  v_user_id UUID;
  v_lead_owner UUID;
  v_stage_aces_id INTEGER;
  v_lead_aces_id INTEGER;
BEGIN
  -- Verificar autenticação e role
  SELECT role, id INTO v_user_role, v_user_id
  FROM crm.users WHERE auth_user_id = auth.uid();

  IF v_user_role IS NULL OR v_user_role = 'NENHUM' THEN
    RAISE EXCEPTION 'Conta aguardando aprovação';
  END IF;

  -- Verificar proprietário do lead (vendedor só move seus próprios leads)
  SELECT owner_id, aces_id INTO v_lead_owner, v_lead_aces_id
  FROM crm.leads
  WHERE id = p_lead_id;

  IF v_user_role = 'VENDEDOR' AND v_lead_owner != v_user_id THEN
    RAISE EXCEPTION 'Você não tem permissão para mover este lead';
  END IF;

  -- Verificar que o stage pertence à mesma empresa
  SELECT aces_id INTO v_stage_aces_id
  FROM crm.pipeline_stages
  WHERE id = p_stage_id;

  IF v_stage_aces_id IS NULL OR v_stage_aces_id != v_lead_aces_id THEN
    RAISE EXCEPTION 'Etapa inválida ou pertence a outra empresa';
  END IF;

  -- Atualizar stage_id (o trigger sync_status_and_stage cuidará de atualizar o texto status)
  UPDATE crm.leads
    SET stage_id = p_stage_id, updated_at = now()
    WHERE id = p_lead_id;
END;
$$;

-- Conceder permissão de execução aos usuários autenticados
GRANT EXECUTE ON FUNCTION crm.rpc_move_lead_to_stage(UUID, UUID) TO authenticated;
;
