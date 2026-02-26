
CREATE TABLE public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  system_prompt text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read on agents" ON public.agents FOR SELECT USING (true);
CREATE POLICY "Allow public insert on agents" ON public.agents FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on agents" ON public.agents FOR UPDATE USING (true);
CREATE POLICY "Allow public delete on agents" ON public.agents FOR DELETE USING (true);

CREATE TABLE public.agent_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  schema_name text NOT NULL,
  table_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_tables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read on agent_tables" ON public.agent_tables FOR SELECT USING (true);
CREATE POLICY "Allow public insert on agent_tables" ON public.agent_tables FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public delete on agent_tables" ON public.agent_tables FOR DELETE USING (true);

ALTER TABLE public.conversations ADD COLUMN agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL;

CREATE TRIGGER update_agents_updated_at
  BEFORE UPDATE ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
