import { supabase } from "@/integrations/supabase/client";
import {
  Message,
  Conversation,
  LLMSettings,
  DatabaseMetadata,
  Agent,
  AgentTable,
  UserProfile,
  UsageSummary,
} from "@/types/database";

const PROFILE_AVATAR_BUCKET = "profile-avatars";

function getSupabasePublicKey(): string {
  const key =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!key) {
    throw new Error("Missing Supabase publishable key in environment.");
  }

  return key;
}

async function getAuthenticatedFunctionHeaders(): Promise<Record<string, string>> {
  const supabaseKey = getSupabasePublicKey();
  const { data, error } = await supabase.auth.getSession();

  if (error) throw error;

  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error("Sessao expirada. Faca login novamente.");
  }

  return {
    "Content-Type": "application/json",
    apikey: supabaseKey,
    Authorization: `Bearer ${accessToken}`,
  };
}

function toSafeNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeUsageSummary(raw: any): UsageSummary {
  return {
    user_id: String(raw?.user_id || ""),
    aces_id: raw?.aces_id === null || raw?.aces_id === undefined ? null : toSafeNumber(raw.aces_id),
    plan_id: String(raw?.plan_id || ""),
    plan_name: String(raw?.plan_name || "Plano"),
    monthly_token_limit: toSafeNumber(raw?.monthly_token_limit),
    monthly_credit_limit: toSafeNumber(raw?.monthly_credit_limit),
    cycle_start_at: String(raw?.cycle_start_at || ""),
    cycle_end_at: String(raw?.cycle_end_at || ""),
    tokens_used: toSafeNumber(raw?.tokens_used),
    credits_used: toSafeNumber(raw?.credits_used),
    usd_spent: toSafeNumber(raw?.usd_spent),
    usage_percent: toSafeNumber(raw?.usage_percent),
    remaining_tokens: toSafeNumber(raw?.remaining_tokens),
    remaining_credits: toSafeNumber(raw?.remaining_credits),
  };
}

async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) {
    throw new Error("Sessao expirada. Faca login novamente.");
  }
  return data.user.id;
}

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
  const headers = await getAuthenticatedFunctionHeaders();

  const response = await fetch(`${supabaseUrl}/functions/v1/external-db-proxy`, {
    method: "POST",
    headers,
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
  const headers = await getAuthenticatedFunctionHeaders();

  const response = await fetch(`${supabaseUrl}/functions/v1/external-db-proxy`, {
    method: "POST",
    headers,
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
  const headers = await getAuthenticatedFunctionHeaders();

  return fetch(`${supabaseUrl}/functions/v1/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ messages, conversationId, agentId }),
  });
}

export async function getMyProfile(): Promise<UserProfile> {
  const userId = await getCurrentUserId();
  const client = supabase as any;

  const { data, error } = await client
    .from("user_profiles")
    .select("*, plan:billing_plans(*)")
    .eq("user_id", userId)
    .single();

  if (error) throw error;
  return data as UserProfile;
}

export async function updateMyProfile(payload: {
  display_name?: string | null;
  username?: string | null;
  avatar_path?: string | null;
  avatar_url?: string | null;
}): Promise<UserProfile> {
  const userId = await getCurrentUserId();
  const updates: Record<string, unknown> = {};

  if ("display_name" in payload) {
    const value = payload.display_name?.trim() ?? null;
    updates.display_name = value && value.length > 0 ? value : null;
  }

  if ("username" in payload) {
    const rawUsername = payload.username?.trim().toLowerCase() ?? null;
    if (rawUsername && !/^[a-z0-9_]{3,30}$/.test(rawUsername)) {
      throw new Error("Nome de usuario invalido. Use 3-30 caracteres: letras, numeros e _.");
    }
    updates.username = rawUsername && rawUsername.length > 0 ? rawUsername : null;
  }

  if ("avatar_path" in payload) {
    updates.avatar_path = payload.avatar_path ?? null;
  }

  if ("avatar_url" in payload) {
    updates.avatar_url = payload.avatar_url ?? null;
  }

  const client = supabase as any;
  const { data, error } = await client
    .from("user_profiles")
    .update(updates)
    .eq("user_id", userId)
    .select("*, plan:billing_plans(*)")
    .single();

  if (error) throw error;
  return data as UserProfile;
}

export async function uploadProfileAvatar(file: File): Promise<UserProfile> {
  const userId = await getCurrentUserId();
  const extension = file.name.includes(".") ? file.name.split(".").pop() : "png";
  const safeExtension = extension && /^[a-zA-Z0-9]+$/.test(extension) ? extension : "png";
  const filePath = `${userId}/avatar-${Date.now()}.${safeExtension}`;

  const { error: uploadError } = await supabase.storage
    .from(PROFILE_AVATAR_BUCKET)
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage
    .from(PROFILE_AVATAR_BUCKET)
    .getPublicUrl(filePath);

  return updateMyProfile({
    avatar_path: filePath,
    avatar_url: publicUrlData.publicUrl || null,
  });
}

export async function getMyUsageSummary(): Promise<UsageSummary> {
  const client = supabase as any;
  const { data, error } = await client.rpc("billing_get_my_usage_summary");
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error("Nao foi possivel carregar o uso mensal.");
  }

  return normalizeUsageSummary(row);
}

export async function getBillingPlans(): Promise<{
  id: string;
  code: string;
  name: string;
  monthly_token_limit: number;
  monthly_credit_limit: number;
  is_active: boolean;
}[]> {
  const client = supabase as any;
  const { data, error } = await client
    .from("billing_plans")
    .select("id, code, name, monthly_token_limit, monthly_credit_limit, is_active")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data || []).map((plan: any) => ({
    id: String(plan.id),
    code: String(plan.code),
    name: String(plan.name),
    monthly_token_limit: toSafeNumber(plan.monthly_token_limit),
    monthly_credit_limit: toSafeNumber(plan.monthly_credit_limit),
    is_active: Boolean(plan.is_active),
  }));
}

export async function testExternalConnection(): Promise<{
  success: boolean;
  message?: string;
  error?: string;
  url?: string;
}> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const headers = await getAuthenticatedFunctionHeaders();

  const response = await fetch(`${supabaseUrl}/functions/v1/external-db-proxy`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "test-connection" }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "Falha ao testar conexao externa.");
  }

  return result;
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
