BEGIN;

CREATE OR REPLACE FUNCTION public.billing_get_my_usage_summary()
RETURNS TABLE (
  user_id uuid,
  aces_id bigint,
  plan_id uuid,
  plan_name text,
  monthly_token_limit bigint,
  monthly_credit_limit bigint,
  cycle_start_at timestamptz,
  cycle_end_at timestamptz,
  tokens_used bigint,
  credits_used numeric(20,4),
  usd_spent numeric(20,6),
  usage_percent numeric(6,2),
  remaining_tokens bigint,
  remaining_credits numeric(20,4)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.billing_get_usage_snapshot(auth.uid(), now());
END;
$$;

REVOKE ALL ON FUNCTION public.billing_get_my_usage_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_get_my_usage_summary() TO authenticated, service_role;

COMMIT;
