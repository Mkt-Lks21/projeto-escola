BEGIN;

CREATE OR REPLACE FUNCTION public.billing_record_usage(
  p_user_id uuid,
  p_conversation_id uuid,
  p_interaction_id uuid,
  p_provider text,
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_reference_at timestamptz DEFAULT now(),
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  event_id uuid,
  user_id uuid,
  aces_id bigint,
  cycle_start_at timestamptz,
  cycle_end_at timestamptz,
  tokens_used bigint,
  credits_used numeric(20,4),
  usd_spent numeric(20,6)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  snapshot_row record;
  pricing_row record;
  normalized_provider text;
  normalized_model text;
  input_tokens integer;
  output_tokens integer;
  total_tokens integer;
  consumed_credits numeric(20,4);
  consumed_usd numeric(20,6);
  created_event_id uuid;
BEGIN
  SELECT *
    INTO snapshot_row
  FROM public.billing_get_usage_snapshot(p_user_id, COALESCE(p_reference_at, now()))
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  IF snapshot_row.aces_id IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_LINKED_TO_ACES';
  END IF;

  normalized_provider := lower(trim(COALESCE(p_provider, '')));
  normalized_model := trim(COALESCE(p_model, ''));

  SELECT
    input_usd_per_1m_tokens,
    output_usd_per_1m_tokens
    INTO pricing_row
  FROM public.llm_model_pricing
  WHERE provider = normalized_provider
    AND model = normalized_model
    AND is_active = true
  ORDER BY updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MODEL_PRICING_NOT_FOUND';
  END IF;

  input_tokens := GREATEST(COALESCE(p_input_tokens, 0), 0);
  output_tokens := GREATEST(COALESCE(p_output_tokens, 0), 0);
  total_tokens := input_tokens + output_tokens;

  consumed_credits := ROUND((total_tokens::numeric / 10::numeric), 4);
  consumed_usd := ROUND(
    (
      (input_tokens::numeric * pricing_row.input_usd_per_1m_tokens) +
      (output_tokens::numeric * pricing_row.output_usd_per_1m_tokens)
    ) / 1000000::numeric,
    6
  );

  INSERT INTO public.billing_usage_events (
    aces_id,
    user_id,
    conversation_id,
    interaction_id,
    provider,
    model,
    input_tokens,
    output_tokens,
    total_tokens,
    credits_used,
    usd_cost,
    cycle_start_at,
    cycle_end_at,
    metadata
  )
  VALUES (
    snapshot_row.aces_id,
    p_user_id,
    p_conversation_id,
    COALESCE(p_interaction_id, gen_random_uuid()),
    normalized_provider,
    normalized_model,
    input_tokens,
    output_tokens,
    total_tokens,
    consumed_credits,
    consumed_usd,
    snapshot_row.cycle_start_at,
    snapshot_row.cycle_end_at,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO created_event_id;

  INSERT INTO public.billing_usage_cycles (
    user_id,
    cycle_start_at,
    cycle_end_at,
    aces_id,
    tokens_used,
    credits_used,
    usd_spent,
    updated_at
  )
  VALUES (
    p_user_id,
    snapshot_row.cycle_start_at,
    snapshot_row.cycle_end_at,
    snapshot_row.aces_id,
    total_tokens,
    consumed_credits,
    consumed_usd,
    now()
  )
  ON CONFLICT ON CONSTRAINT billing_usage_cycles_pkey
  DO UPDATE SET
    aces_id = EXCLUDED.aces_id,
    cycle_end_at = EXCLUDED.cycle_end_at,
    tokens_used = public.billing_usage_cycles.tokens_used + EXCLUDED.tokens_used,
    credits_used = public.billing_usage_cycles.credits_used + EXCLUDED.credits_used,
    usd_spent = public.billing_usage_cycles.usd_spent + EXCLUDED.usd_spent,
    updated_at = now();

  RETURN QUERY
  SELECT
    created_event_id AS event_id,
    buc.user_id,
    buc.aces_id,
    buc.cycle_start_at,
    buc.cycle_end_at,
    buc.tokens_used,
    buc.credits_used,
    buc.usd_spent
  FROM public.billing_usage_cycles AS buc
  WHERE buc.user_id = p_user_id
    AND buc.cycle_start_at = snapshot_row.cycle_start_at
  LIMIT 1;
END;
$$;

COMMIT;
