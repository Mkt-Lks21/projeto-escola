CREATE TABLE IF NOT EXISTS public.frontend_error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NULL REFERENCES public.conversations(id) ON DELETE SET NULL,
  category text NOT NULL,
  stage text NULL,
  code text NULL,
  message text NOT NULL,
  pathname text NULL,
  user_agent text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_frontend_error_logs_user_created
  ON public.frontend_error_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_frontend_error_logs_conversation_created
  ON public.frontend_error_logs (conversation_id, created_at DESC);

ALTER TABLE public.frontend_error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frontend_error_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own frontend error logs" ON public.frontend_error_logs;
CREATE POLICY "Users can read own frontend error logs"
  ON public.frontend_error_logs FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own frontend error logs" ON public.frontend_error_logs;
CREATE POLICY "Users can insert own frontend error logs"
  ON public.frontend_error_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);
