-- Create conversations table
CREATE TABLE public.conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Nova Conversa',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create messages table
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create llm_settings table (stores encrypted API keys)
CREATE TABLE public.llm_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'google')),
  model TEXT NOT NULL,
  api_key TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create database_metadata_cache table
CREATE TABLE public.database_metadata_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  schema_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  data_type TEXT NOT NULL,
  is_nullable BOOLEAN NOT NULL DEFAULT true,
  column_default TEXT,
  cached_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(schema_name, table_name, column_name)
);

-- Enable RLS but allow public access (no auth required per user request)
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.database_metadata_cache ENABLE ROW LEVEL SECURITY;

-- Public access policies for conversations
CREATE POLICY "Allow public read on conversations" ON public.conversations FOR SELECT USING (true);
CREATE POLICY "Allow public insert on conversations" ON public.conversations FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on conversations" ON public.conversations FOR UPDATE USING (true);
CREATE POLICY "Allow public delete on conversations" ON public.conversations FOR DELETE USING (true);

-- Public access policies for messages
CREATE POLICY "Allow public read on messages" ON public.messages FOR SELECT USING (true);
CREATE POLICY "Allow public insert on messages" ON public.messages FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public delete on messages" ON public.messages FOR DELETE USING (true);

-- Public access policies for llm_settings (single row for app settings)
CREATE POLICY "Allow public read on llm_settings" ON public.llm_settings FOR SELECT USING (true);
CREATE POLICY "Allow public insert on llm_settings" ON public.llm_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on llm_settings" ON public.llm_settings FOR UPDATE USING (true);

-- Public access policies for database_metadata_cache
CREATE POLICY "Allow public read on metadata cache" ON public.database_metadata_cache FOR SELECT USING (true);
CREATE POLICY "Allow public insert on metadata cache" ON public.database_metadata_cache FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public delete on metadata cache" ON public.database_metadata_cache FOR DELETE USING (true);

-- Create indexes for better performance
CREATE INDEX idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX idx_messages_created_at ON public.messages(created_at);
CREATE INDEX idx_metadata_cache_table ON public.database_metadata_cache(schema_name, table_name);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_llm_settings_updated_at
  BEFORE UPDATE ON public.llm_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;