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

export interface BillingPlan {
  id: string;
  code: string;
  name: string;
  monthly_token_limit: number;
  monthly_credit_limit: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  user_id: string;
  aces_id: number | null;
  display_name: string | null;
  username: string | null;
  avatar_path: string | null;
  avatar_url: string | null;
  plan_id: string | null;
  billing_anchor_day: number;
  billing_timezone: string;
  created_at: string;
  updated_at: string;
  plan?: BillingPlan | null;
}

export interface UsageSummary {
  user_id: string;
  aces_id: number | null;
  plan_id: string;
  plan_name: string;
  monthly_token_limit: number;
  monthly_credit_limit: number;
  cycle_start_at: string;
  cycle_end_at: string;
  tokens_used: number;
  credits_used: number;
  usd_spent: number;
  usage_percent: number;
  remaining_tokens: number;
  remaining_credits: number;
}

export interface UsageLimitError {
  code: "USER_NOT_LINKED_TO_ACES" | "USAGE_LIMIT_REACHED";
  message: string;
  usage?: {
    usedCredits: number;
    limitCredits: number;
    percent: number;
    cycleEndAt: string;
  };
}
