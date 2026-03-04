BEGIN;

-- Billing plans
CREATE TABLE IF NOT EXISTS public.billing_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  monthly_token_limit bigint NOT NULL CHECK (monthly_token_limit > 0),
  monthly_credit_limit bigint NOT NULL CHECK (monthly_credit_limit > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.billing_plans (code, name, monthly_token_limit, monthly_credit_limit, is_active)
VALUES ('test_1m', 'Plano Teste', 1000000, 100000, true)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  monthly_token_limit = EXCLUDED.monthly_token_limit,
  monthly_credit_limit = EXCLUDED.monthly_credit_limit,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- Provider/model pricing used by billing conversion
CREATE TABLE IF NOT EXISTS public.llm_model_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model text NOT NULL,
  input_usd_per_1m_tokens numeric(12, 6) NOT NULL CHECK (input_usd_per_1m_tokens >= 0),
  output_usd_per_1m_tokens numeric(12, 6) NOT NULL CHECK (output_usd_per_1m_tokens >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_llm_model_pricing_active
  ON public.llm_model_pricing (provider, model)
  WHERE is_active = true;

INSERT INTO public.llm_model_pricing (provider, model, input_usd_per_1m_tokens, output_usd_per_1m_tokens, is_active)
VALUES
  ('openai', 'gpt-4o', 5.000000, 15.000000, true),
  ('openai', 'gpt-4o-mini', 0.150000, 0.600000, true),
  ('openai', 'gpt-4-turbo', 10.000000, 30.000000, true),
  ('openai', 'gpt-4', 30.000000, 60.000000, true),
  ('openai', 'gpt-3.5-turbo', 0.500000, 1.500000, true),
  ('gemini', 'gemini-2.5-flash', 0.350000, 1.050000, true),
  ('gemini', 'gemini-2.5-flash-lite', 0.100000, 0.300000, true),
  ('gemini', 'gemini-2.5-pro', 3.500000, 10.500000, true)
ON CONFLICT DO NOTHING;

-- User profile and billing config
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  aces_id bigint,
  display_name text,
  username text,
  avatar_path text,
  avatar_url text,
  plan_id uuid REFERENCES public.billing_plans(id),
  billing_anchor_day smallint NOT NULL CHECK (billing_anchor_day BETWEEN 1 AND 31),
  billing_timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_profiles_username_format CHECK (
    username IS NULL OR username ~ '^[a-z0-9_]{3,30}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_profiles_username_lower
  ON public.user_profiles ((lower(username)))
  WHERE username IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_aces_user
  ON public.user_profiles (aces_id, user_id);

-- Raw usage events (one row per interaction)
CREATE TABLE IF NOT EXISTS public.billing_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id bigint NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  interaction_id uuid NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  total_tokens integer NOT NULL CHECK (total_tokens >= 0),
  credits_used numeric(20, 4) NOT NULL CHECK (credits_used >= 0),
  usd_cost numeric(20, 6) NOT NULL CHECK (usd_cost >= 0),
  cycle_start_at timestamptz NOT NULL,
  cycle_end_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_usage_events_user_created
  ON public.billing_usage_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_usage_events_aces_created
  ON public.billing_usage_events (aces_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_usage_events_user_cycle
  ON public.billing_usage_events (user_id, cycle_start_at);

-- Aggregated usage per cycle
CREATE TABLE IF NOT EXISTS public.billing_usage_cycles (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cycle_start_at timestamptz NOT NULL,
  cycle_end_at timestamptz NOT NULL,
  aces_id bigint NOT NULL,
  tokens_used bigint NOT NULL DEFAULT 0 CHECK (tokens_used >= 0),
  credits_used numeric(20, 4) NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
  usd_spent numeric(20, 6) NOT NULL DEFAULT 0 CHECK (usd_spent >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cycle_start_at)
);

CREATE INDEX IF NOT EXISTS idx_billing_usage_cycles_aces
  ON public.billing_usage_cycles (aces_id, cycle_start_at DESC);

-- Keep user profile values normalized and with defaults.
CREATE OR REPLACE FUNCTION public.normalize_user_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  default_plan_id uuid;
BEGIN
  IF NEW.username IS NOT NULL THEN
    NEW.username := lower(trim(NEW.username));
    IF NEW.username = '' THEN
      NEW.username := NULL;
    END IF;
  END IF;

  IF NEW.display_name IS NOT NULL THEN
    NEW.display_name := trim(NEW.display_name);
    IF NEW.display_name = '' THEN
      NEW.display_name := NULL;
    END IF;
  END IF;

  IF NEW.billing_timezone IS NULL OR trim(NEW.billing_timezone) = '' THEN
    NEW.billing_timezone := 'America/Sao_Paulo';
  END IF;

  IF NEW.billing_anchor_day IS NULL THEN
    NEW.billing_anchor_day := EXTRACT(DAY FROM timezone('America/Sao_Paulo', now()))::smallint;
  ELSE
    NEW.billing_anchor_day := LEAST(31, GREATEST(1, NEW.billing_anchor_day));
  END IF;

  IF NEW.plan_id IS NULL THEN
    SELECT id
      INTO default_plan_id
      FROM public.billing_plans
      WHERE code = 'test_1m'
      ORDER BY created_at ASC
      LIMIT 1;

    IF default_plan_id IS NULL THEN
      SELECT id
        INTO default_plan_id
        FROM public.billing_plans
        WHERE is_active = true
        ORDER BY created_at ASC
        LIMIT 1;
    END IF;

    NEW.plan_id := default_plan_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_user_profile_fields_trigger ON public.user_profiles;
CREATE TRIGGER normalize_user_profile_fields_trigger
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_user_profile_fields();

DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_billing_plans_updated_at ON public.billing_plans;
CREATE TRIGGER update_billing_plans_updated_at
  BEFORE UPDATE ON public.billing_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_llm_model_pricing_updated_at ON public.llm_model_pricing;
CREATE TRIGGER update_llm_model_pricing_updated_at
  BEFORE UPDATE ON public.llm_model_pricing
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile when auth user is created.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  default_plan_id uuid;
BEGIN
  SELECT id
    INTO default_plan_id
    FROM public.billing_plans
    WHERE code = 'test_1m'
    ORDER BY created_at ASC
    LIMIT 1;

  IF default_plan_id IS NULL THEN
    SELECT id
      INTO default_plan_id
      FROM public.billing_plans
      WHERE is_active = true
      ORDER BY created_at ASC
      LIMIT 1;
  END IF;

  INSERT INTO public.user_profiles (
    user_id,
    display_name,
    plan_id,
    billing_anchor_day,
    billing_timezone
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)),
    default_plan_id,
    EXTRACT(DAY FROM timezone('America/Sao_Paulo', now()))::smallint,
    'America/Sao_Paulo'
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_user_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_user_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user_profile();

-- Backfill missing profiles for existing auth users.
INSERT INTO public.user_profiles (
  user_id,
  display_name,
  plan_id,
  billing_anchor_day,
  billing_timezone
)
SELECT
  au.id AS user_id,
  split_part(au.email, '@', 1) AS display_name,
  bp.id AS plan_id,
  EXTRACT(DAY FROM timezone('America/Sao_Paulo', now()))::smallint AS billing_anchor_day,
  'America/Sao_Paulo' AS billing_timezone
FROM auth.users au
CROSS JOIN LATERAL (
  SELECT id
  FROM public.billing_plans
  WHERE code = 'test_1m'
  ORDER BY created_at ASC
  LIMIT 1
) bp
LEFT JOIN public.user_profiles up ON up.user_id = au.id
WHERE up.user_id IS NULL;

-- Returns start/end bounds for a rolling monthly cycle anchored by day-of-month.
CREATE OR REPLACE FUNCTION public.billing_cycle_bounds(
  p_reference_at timestamptz,
  p_anchor_day smallint,
  p_timezone text
)
RETURNS TABLE (
  cycle_start_at timestamptz,
  cycle_end_at timestamptz
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  reference_local timestamp;
  tz text;
  anchor_day integer;
  month_start date;
  previous_month_start date;
  next_month_start date;
  this_month_effective_day integer;
  previous_month_effective_day integer;
  next_month_effective_day integer;
  this_month_last_day integer;
  previous_month_last_day integer;
  next_month_last_day integer;
  start_date date;
  end_date date;
BEGIN
  tz := COALESCE(NULLIF(trim(p_timezone), ''), 'America/Sao_Paulo');
  anchor_day := LEAST(31, GREATEST(1, COALESCE(p_anchor_day, 1)));
  reference_local := COALESCE(p_reference_at, now()) AT TIME ZONE tz;

  month_start := date_trunc('month', reference_local)::date;
  this_month_last_day := EXTRACT(DAY FROM (month_start + INTERVAL '1 month - 1 day'))::integer;
  this_month_effective_day := LEAST(anchor_day, this_month_last_day);

  IF reference_local::date >= (month_start + (this_month_effective_day - 1)) THEN
    start_date := month_start + (this_month_effective_day - 1);
  ELSE
    previous_month_start := (month_start - INTERVAL '1 month')::date;
    previous_month_last_day := EXTRACT(DAY FROM (month_start - INTERVAL '1 day'))::integer;
    previous_month_effective_day := LEAST(anchor_day, previous_month_last_day);
    start_date := previous_month_start + (previous_month_effective_day - 1);
  END IF;

  next_month_start := date_trunc('month', (start_date + INTERVAL '1 month')::timestamp)::date;
  next_month_last_day := EXTRACT(DAY FROM (next_month_start + INTERVAL '1 month - 1 day'))::integer;
  next_month_effective_day := LEAST(anchor_day, next_month_last_day);
  end_date := next_month_start + (next_month_effective_day - 1);

  cycle_start_at := start_date::timestamp AT TIME ZONE tz;
  cycle_end_at := end_date::timestamp AT TIME ZONE tz;
  RETURN NEXT;
END;
$$;

-- Snapshot helper consumed by edge functions and frontend.
CREATE OR REPLACE FUNCTION public.billing_get_usage_snapshot(
  p_user_id uuid,
  p_reference_at timestamptz DEFAULT now()
)
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
SET search_path = public
AS $$
DECLARE
  profile_row record;
  cycle_row record;
BEGIN
  SELECT
    up.user_id,
    up.aces_id,
    up.plan_id,
    up.billing_anchor_day,
    up.billing_timezone,
    bp.name AS plan_name,
    bp.monthly_token_limit,
    bp.monthly_credit_limit
  INTO profile_row
  FROM public.user_profiles up
  JOIN public.billing_plans bp ON bp.id = up.plan_id
  WHERE up.user_id = p_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT bounds.cycle_start_at, bounds.cycle_end_at
  INTO cycle_row
  FROM public.billing_cycle_bounds(
    COALESCE(p_reference_at, now()),
    profile_row.billing_anchor_day,
    profile_row.billing_timezone
  ) bounds;

  RETURN QUERY
  SELECT
    profile_row.user_id::uuid AS user_id,
    profile_row.aces_id::bigint AS aces_id,
    profile_row.plan_id::uuid AS plan_id,
    profile_row.plan_name::text AS plan_name,
    profile_row.monthly_token_limit::bigint AS monthly_token_limit,
    profile_row.monthly_credit_limit::bigint AS monthly_credit_limit,
    cycle_row.cycle_start_at::timestamptz AS cycle_start_at,
    cycle_row.cycle_end_at::timestamptz AS cycle_end_at,
    COALESCE(c.tokens_used, 0)::bigint AS tokens_used,
    COALESCE(c.credits_used, 0)::numeric(20,4) AS credits_used,
    COALESCE(c.usd_spent, 0)::numeric(20,6) AS usd_spent,
    CASE
      WHEN profile_row.monthly_token_limit > 0
        THEN LEAST(
          100::numeric,
          ROUND((COALESCE(c.tokens_used, 0)::numeric / profile_row.monthly_token_limit::numeric) * 100::numeric, 2)
        )::numeric(6,2)
      ELSE 0::numeric(6,2)
    END AS usage_percent,
    GREATEST(profile_row.monthly_token_limit - COALESCE(c.tokens_used, 0), 0)::bigint AS remaining_tokens,
    GREATEST(profile_row.monthly_credit_limit::numeric - COALESCE(c.credits_used, 0), 0)::numeric(20,4) AS remaining_credits
  FROM (
    SELECT 1 AS marker
  ) base
  LEFT JOIN public.billing_usage_cycles c
    ON c.user_id = profile_row.user_id
   AND c.cycle_start_at = cycle_row.cycle_start_at;
END;
$$;

-- Public authenticated helper for usage panel.
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
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT *
  FROM public.billing_get_usage_snapshot(auth.uid(), now());
$$;

-- Records one usage event and updates aggregated cycle usage atomically.
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
  ON CONFLICT (user_id, cycle_start_at)
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
  FROM public.billing_usage_cycles buc
  WHERE buc.user_id = p_user_id
    AND buc.cycle_start_at = snapshot_row.cycle_start_at
  LIMIT 1;
END;
$$;

-- RLS for new tables
ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_model_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_usage_cycles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read billing plans" ON public.billing_plans;
CREATE POLICY "Authenticated users can read billing plans"
  ON public.billing_plans FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can read own profile" ON public.user_profiles;
CREATE POLICY "Users can read own profile"
  ON public.user_profiles FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
CREATE POLICY "Users can update own profile"
  ON public.user_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;
CREATE POLICY "Users can insert own profile"
  ON public.user_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own usage events" ON public.billing_usage_events;
CREATE POLICY "Users can read own usage events"
  ON public.billing_usage_events FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own usage cycles" ON public.billing_usage_cycles;
CREATE POLICY "Users can read own usage cycles"
  ON public.billing_usage_cycles FOR SELECT
  USING (auth.uid() = user_id);

-- Lock down direct execution; expose only intended functions to app clients.
REVOKE ALL ON FUNCTION public.billing_get_usage_snapshot(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_record_usage(uuid, uuid, uuid, text, text, integer, integer, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.billing_get_usage_snapshot(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_record_usage(uuid, uuid, uuid, text, text, integer, integer, timestamptz, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_get_my_usage_summary() TO authenticated, service_role;

-- Storage for avatar uploads
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-avatars', 'profile-avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users can upload own profile avatars" ON storage.objects;
CREATE POLICY "Users can upload own profile avatars"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profile-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can update own profile avatars" ON storage.objects;
CREATE POLICY "Users can update own profile avatars"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'profile-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'profile-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can delete own profile avatars" ON storage.objects;
CREATE POLICY "Users can delete own profile avatars"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'profile-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

COMMIT;
