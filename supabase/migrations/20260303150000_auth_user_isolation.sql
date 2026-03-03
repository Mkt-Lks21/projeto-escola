BEGIN;

-- Legacy cleanup requested: remove publicly created data before enabling per-user ownership.
DELETE FROM public.messages;
DELETE FROM public.agent_tables;
DELETE FROM public.conversations;
DELETE FROM public.agents;
DELETE FROM public.llm_settings;

-- Keep backward compatibility for older provider values while supporting current app value.
ALTER TABLE public.llm_settings DROP CONSTRAINT IF EXISTS llm_settings_provider_check;
ALTER TABLE public.llm_settings
  ADD CONSTRAINT llm_settings_provider_check
  CHECK (provider IN ('openai', 'google', 'gemini'));

-- Ownership columns.
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.llm_settings ADD COLUMN IF NOT EXISTS user_id uuid;

ALTER TABLE public.conversations ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.agents ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.llm_settings ALTER COLUMN user_id SET DEFAULT auth.uid();

ALTER TABLE public.conversations ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.agents ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.llm_settings ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_user_id_fkey;
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_user_id_fkey;
ALTER TABLE public.llm_settings DROP CONSTRAINT IF EXISTS llm_settings_user_id_fkey;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.agents
  ADD CONSTRAINT agents_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.llm_settings
  ADD CONSTRAINT llm_settings_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON public.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_agents_user_id ON public.agents(user_id);
CREATE INDEX IF NOT EXISTS idx_llm_settings_user_id ON public.llm_settings(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_llm_settings_active_per_user
  ON public.llm_settings(user_id)
  WHERE is_active = true;

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_settings ENABLE ROW LEVEL SECURITY;

-- Remove public-all policies.
DROP POLICY IF EXISTS "Allow public read on conversations" ON public.conversations;
DROP POLICY IF EXISTS "Allow public insert on conversations" ON public.conversations;
DROP POLICY IF EXISTS "Allow public update on conversations" ON public.conversations;
DROP POLICY IF EXISTS "Allow public delete on conversations" ON public.conversations;

DROP POLICY IF EXISTS "Allow public read on messages" ON public.messages;
DROP POLICY IF EXISTS "Allow public insert on messages" ON public.messages;
DROP POLICY IF EXISTS "Allow public delete on messages" ON public.messages;

DROP POLICY IF EXISTS "Allow public read on agents" ON public.agents;
DROP POLICY IF EXISTS "Allow public insert on agents" ON public.agents;
DROP POLICY IF EXISTS "Allow public update on agents" ON public.agents;
DROP POLICY IF EXISTS "Allow public delete on agents" ON public.agents;

DROP POLICY IF EXISTS "Allow public read on agent_tables" ON public.agent_tables;
DROP POLICY IF EXISTS "Allow public insert on agent_tables" ON public.agent_tables;
DROP POLICY IF EXISTS "Allow public delete on agent_tables" ON public.agent_tables;

DROP POLICY IF EXISTS "Allow public read on llm_settings" ON public.llm_settings;
DROP POLICY IF EXISTS "Allow public insert on llm_settings" ON public.llm_settings;
DROP POLICY IF EXISTS "Allow public update on llm_settings" ON public.llm_settings;

-- Conversations policies.
CREATE POLICY "Users can select own conversations"
  ON public.conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own conversations"
  ON public.conversations FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own conversations"
  ON public.conversations FOR DELETE
  USING (auth.uid() = user_id);

-- Messages policies (ownership inherited from conversation).
CREATE POLICY "Users can select own messages"
  ON public.messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own messages"
  ON public.messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own messages"
  ON public.messages FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );

-- Agents policies.
CREATE POLICY "Users can select own agents"
  ON public.agents FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own agents"
  ON public.agents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own agents"
  ON public.agents FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own agents"
  ON public.agents FOR DELETE
  USING (auth.uid() = user_id);

-- Agent tables policies (ownership inherited from agent).
CREATE POLICY "Users can select own agent tables"
  ON public.agent_tables FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.agents a
      WHERE a.id = agent_tables.agent_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own agent tables"
  ON public.agent_tables FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.agents a
      WHERE a.id = agent_tables.agent_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own agent tables"
  ON public.agent_tables FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.agents a
      WHERE a.id = agent_tables.agent_id
        AND a.user_id = auth.uid()
    )
  );

-- LLM settings policies.
CREATE POLICY "Users can select own llm settings"
  ON public.llm_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own llm settings"
  ON public.llm_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own llm settings"
  ON public.llm_settings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMIT;
