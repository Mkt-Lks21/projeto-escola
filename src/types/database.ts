export interface Message {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface Conversation {
  agent_id?: string | null;
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  user_id?: string;
}

export interface LLMSettings {
  id: string;
  provider: string;
  model: string;
  api_key: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  user_id?: string;
}

export interface DatabaseMetadata {
  id: string;
  schema_name: string;
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: boolean;
  column_default: string | null;
  cached_at: string;
}

export const OPENAI_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
  "gpt-4",
  "gpt-3.5-turbo",
];

export const GOOGLE_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
];

export interface Agent {
  id: string;
  name: string;
  description: string;
  system_prompt: string | null;
  created_at: string;
  updated_at: string;
  user_id?: string;
}

export interface AgentTable {
  id: string;
  agent_id: string;
  schema_name: string;
  table_name: string;
  created_at: string;
}
