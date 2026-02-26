import { supabase } from "@/integrations/supabase/client";
import { Message, Conversation, LLMSettings, DatabaseMetadata, Agent, AgentTable } from "@/types/database";

export async function getConversations(): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function createConversation(title?: string, agentId?: string): Promise<Conversation> {
  const insertData: any = { title: title || "Nova Conversa" };
  if (agentId) insertData.agent_id = agentId;

  const { data, error } = await supabase
    .from("conversations")
    .insert(insertData)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateConversationTitle(id: string, title: string): Promise<void> {
  const { error } = await supabase
    .from("conversations")
    .update({ title })
    .eq("id", id);

  if (error) throw error;
}

export async function deleteConversation(id: string): Promise<void> {
  const { error } = await supabase.from("conversations").delete().eq("id", id);
  if (error) throw error;
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function createMessage(
  conversationId: string,
  role: string,
  content: string
): Promise<Message> {
  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, role, content })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getLLMSettings(): Promise<LLMSettings | null> {
  const { data, error } = await supabase
    .from("llm_settings")
    .select("*")
    .eq("is_active", true)
    .single();

  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function saveLLMSettings(settings: {
  provider: string;
  model: string;
  api_key: string;
}): Promise<LLMSettings> {
  await supabase.from("llm_settings").update({ is_active: false }).eq("is_active", true);

  const { data, error } = await supabase
    .from("llm_settings")
    .insert({ ...settings, is_active: true })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getMetadata(): Promise<DatabaseMetadata[]> {
  return fetchExternalMetadata();
}

export async function refreshMetadata(): Promise<void> {
  await fetchExternalMetadata();
}

export async function fetchExternalMetadata(): Promise<DatabaseMetadata[]> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const response = await fetch(`${supabaseUrl}/functions/v1/external-db-proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({ action: "fetch-metadata" }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Failed to fetch external metadata");
  }

  if (result.hint) {
    throw new Error(result.message + " " + result.hint);
  }

  return (result.data || [])
    .filter((item: any) => item.schema_name === "public")
    .map((item: any, index: number) => ({
      id: `external-${index}`,
      schema_name: item.schema_name,
      table_name: item.table_name,
      column_name: item.column_name,
      data_type: item.data_type,
      is_nullable: item.is_nullable,
      column_default: item.column_default,
      cached_at: new Date().toISOString(),
    }));
}

export async function cacheExternalMetadata(_metadata: DatabaseMetadata[]): Promise<void> {
  return;
}

export async function executeExternalQuery(query: string): Promise<any[]> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const response = await fetch(`${supabaseUrl}/functions/v1/external-db-proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({ action: "execute-query", query }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Failed to execute query");
  }

  return result.data || [];
}

export async function sendChatMessage(
  messages: { role: string; content: string }[],
  conversationId: string,
  agentId?: string
): Promise<Response> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  return fetch(`${supabaseUrl}/functions/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({ messages, conversationId, agentId }),
  });
}

// ===== AGENTS API =====

export async function getAgents(): Promise<Agent[]> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []) as unknown as Agent[];
}

export async function getAgent(id: string): Promise<Agent> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as unknown as Agent;
}

export async function createAgent(agent: {
  name: string;
  description?: string;
  system_prompt?: string | null;
}): Promise<Agent> {
  const { data, error } = await supabase
    .from("agents")
    .insert(agent)
    .select()
    .single();

  if (error) throw error;
  return data as unknown as Agent;
}

export async function updateAgent(id: string, agent: {
  name?: string;
  description?: string;
  system_prompt?: string | null;
}): Promise<Agent> {
  const { data, error } = await supabase
    .from("agents")
    .update(agent)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as unknown as Agent;
}

export async function deleteAgent(id: string): Promise<void> {
  const { error } = await supabase.from("agents").delete().eq("id", id);
  if (error) throw error;
}

export async function getAgentTables(agentId: string): Promise<AgentTable[]> {
  const { data, error } = await supabase
    .from("agent_tables")
    .select("*")
    .eq("agent_id", agentId);

  if (error) throw error;
  return (data || []) as unknown as AgentTable[];
}

export async function setAgentTables(
  agentId: string,
  tables: { schema_name: string; table_name: string }[]
): Promise<void> {
  await supabase.from("agent_tables").delete().eq("agent_id", agentId);

  if (tables.length > 0) {
    const { error } = await supabase
      .from("agent_tables")
      .insert(tables.map((t) => ({ agent_id: agentId, ...t })));
    if (error) throw error;
  }
}

export async function executeQuery(query: string): Promise<any[]> {
  return executeExternalQuery(query);
}
