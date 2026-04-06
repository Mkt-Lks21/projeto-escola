import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { routeToSpecialist } from "./supervisor.ts";
import { generateSqlQuery, type QueryGeneratorOutput } from "./queryGenerator.ts";
import { resolveSchemas } from "./dictionaries/index.ts";
import { createCorsHeaders, enforceCors, getRequestId, rateLimitByUser } from "../_shared/security.ts";

const DEFAULT_PYTHON_API_URL = "https://arquem-python-api.onrender.com";
const SQL_DEBUG_ALLOWED_TAG = "[SQL_DEBUG_ALLOWED]";
const INSIGHT_CONTENT_TAG = "[INSIGHT_CONTENT]";
const CHART_INSIGHT_CONTENT_TAG = "[CHART_INSIGHT_CONTENT]";
const MAX_INSIGHT_ROWS = 200;
const INSIGHT_TEMPERATURE = 0.4;
const USAGE_SAFETY_MARGIN_TOKENS = 2000;
const QUERY_GENERATOR_MAX_RETRIES = 1;
export const QUERY_GENERATOR_USER_FRIENDLY_ERROR =
  "Nao consegui montar a consulta agora. Tente reformular sua pergunta com mais contexto (periodo, entidade ou filtro).";

const CHART_TYPES = ["bar", "line", "pie", "scatter"] as const;
const INSIGHT_SCOPES = ["broad", "specific"] as const;
const TOOL_NAMES = ["generate_chart", "generate_insight"] as const;
type ChartType = (typeof CHART_TYPES)[number];
type InsightScope = (typeof INSIGHT_SCOPES)[number];
type ToolName = (typeof TOOL_NAMES)[number];
type ProviderName = "openai" | "gemini";
type UserIntent = "chart" | "insight" | "explicit_sql" | "default";

type ChartToolArgs = {
  sql_query: string;
  chart_type: ChartType;
  chart_title: string;
};

type InsightToolArgs = {
  sql_query: string;
  analysis_scope: InsightScope;
  analysis_focus: string;
};

type InsightContentPayload = {
  success: boolean;
  analysis_scope: InsightScope;
  analysis_focus: string;
  row_count: number;
  columns: string[];
  rows: Record<string, unknown>[];
  insight_text: string;
  sql_debug?: string;
};

type ChartInsightContentPayload = {
  success: boolean;
  row_count: number;
  chart_payload: Record<string, unknown>;
  insight_text: string;
  analysis_scope: InsightScope;
  analysis_focus: string;
  warnings: string[];
  sql_debug?: string;
};

type ChatMessage = {
  role: string;
  content: string;
};

type ActiveSettings = {
  provider: ProviderName;
  apiKey: string;
  model: string;
};

type LLMCallOptions = {
  withTools?: boolean;
  forceToolName?: ToolName | null;
  temperature?: number;
};

type LLMResult =
  | { type: "text"; text: string }
  | { type: "tool_call_chart"; args: ChartToolArgs }
  | { type: "tool_call_insight"; args: InsightToolArgs };

type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type LLMProviderResponse = {
  result: LLMResult;
  usage: TokenUsage;
};

type AuthenticatedUser = {
  id: string;
};

type BillingUsageSnapshot = {
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
};

type DelphiProxyPayload = {
  fields: string;
  tables: string;
  cond: string;
  order?: string;
  rowspPage?: number;
  pageNumber?: number;
  empresa?: string;
};

type DelphiProxyResult = {
  success: boolean;
  data: Record<string, unknown>[];
  rowCount: number;
  pagination?: {
    pageNumber: number;
    totalPages: number;
    totalRec: number;
  };
  error?: string;
};

type SwarmFlowResult = {
  response: Response;
  usage: TokenUsage;
  selectedWorkers: string[];
};

type SwarmQueryPayload = {
  fields: string;
  tables: string;
  cond: string;
  order?: string;
  rowspPage?: number;
  chart_type?: "bar" | "line" | "pie" | "scatter";
  chart_title?: string;
};

class SwarmFlowError extends Error {
  usage: TokenUsage;

  constructor(message: string, usage: TokenUsage) {
    super(message);
    this.name = "SwarmFlowError";
    this.usage = usage;
  }
}

const OPENAI_TOOLS = [
  {
    type: "function",
    function: {
      name: "generate_chart",
      description:
        "Gera visualizacao de dados executando uma SQL no banco e criando configuracao Plotly.",
      parameters: {
        type: "object",
        properties: {
          sql_query: {
            type: "string",
            description: "Query SQL de leitura para buscar os dados do grafico.",
          },
          chart_type: {
            type: "string",
            enum: [...CHART_TYPES],
            description: "Tipo de grafico desejado.",
          },
          chart_title: {
            type: "string",
            description: "Titulo do grafico.",
          },
        },
        required: ["sql_query", "chart_type", "chart_title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_insight",
      description:
        "Monta uma query de leitura para analise textual baseada em dados de negocio.",
      parameters: {
        type: "object",
        properties: {
          sql_query: {
            type: "string",
            description: "Query SQL de leitura para buscar dados da analise.",
          },
          analysis_scope: {
            type: "string",
            enum: [...INSIGHT_SCOPES],
            description: "Escopo da analise: broad para visao ampla, specific para pergunta direta.",
          },
          analysis_focus: {
            type: "string",
            description: "Foco de negocio da analise (ex: vendas mensais, margem, churn).",
          },
        },
        required: ["sql_query", "analysis_scope", "analysis_focus"],
      },
    },
  },
];

const GEMINI_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "generate_chart",
        description:
          "Gera visualizacao de dados executando uma SQL no banco e criando configuracao Plotly.",
        parameters: {
          type: "OBJECT",
          properties: {
            sql_query: {
              type: "STRING",
              description: "Query SQL de leitura para buscar os dados do grafico.",
            },
            chart_type: {
              type: "STRING",
              enum: [...CHART_TYPES],
              description: "Tipo de grafico desejado.",
            },
            chart_title: {
              type: "STRING",
              description: "Titulo do grafico.",
            },
          },
          required: ["sql_query", "chart_type", "chart_title"],
        },
      },
      {
        name: "generate_insight",
        description:
          "Monta uma query de leitura para analise textual baseada em dados de negocio.",
        parameters: {
          type: "OBJECT",
          properties: {
            sql_query: {
              type: "STRING",
              description: "Query SQL de leitura para buscar dados da analise.",
            },
            analysis_scope: {
              type: "STRING",
              enum: [...INSIGHT_SCOPES],
              description: "Escopo da analise: broad para visao ampla, specific para pergunta direta.",
            },
            analysis_focus: {
              type: "STRING",
              description: "Foco de negocio da analise (ex: vendas mensais, margem, churn).",
            },
          },
          required: ["sql_query", "analysis_scope", "analysis_focus"],
        },
      },
    ],
  },
];

export async function handleChatRequest(req: Request): Promise<Response> {
  const corsResponse = enforceCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return createJsonResponse(req, { error: "Metodo nao permitido. Use POST." }, 405);
  }

  try {
    const requestId = getRequestId(req);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const internalProxyKey = Deno.env.get("INTERNAL_PROXY_KEY");
    // service_role is restricted to server-side execution and privileged RPC calls.
    // Never expose this key to frontend clients.

    if (!supabaseUrl || !supabaseKey || !internalProxyKey) {
      return createJsonResponse(
        req,
        { error: "Segredos SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e INTERNAL_PROXY_KEY sao obrigatorios." },
        500,
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const accessToken = extractBearerToken(req);
    const authenticatedUser = await authenticateRequestUser(accessToken, supabase);

    if (!authenticatedUser) {
      return createJsonResponse(
        req,
        { error: "Missing or invalid authorization token.", request_id: requestId },
        401,
        { "x-request-id": requestId },
      );
    }
    const rateLimit = await rateLimitByUser(authenticatedUser.id, "chat");
    if (!rateLimit.allowed) {
      return createJsonResponse(
        req,
        { error: "Rate limit excedido.", reset_at: rateLimit.resetAtEpochMs, request_id: requestId },
        429,
        { "x-request-id": requestId },
      );
    }

    const body = await req.json();
    const messages = normalizeRequestMessages(body?.messages);
    const agentId = typeof body?.agentId === "string" ? body.agentId : null;
    const conversationId = typeof body?.conversationId === "string" ? body.conversationId : null;
    const sqlDebugRequested = toBooleanFlag(body?.sqlDebug);
    const interactionId = crypto.randomUUID();

    if (conversationId) {
      const { data: conversation } = await supabase
        .from("conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("user_id", authenticatedUser.id)
        .maybeSingle();

      if (!conversation) {
        return createJsonResponse(
          req,
          { error: "Conversa nao encontrada para este usuario." },
          404,
        );
      }
    }

    const { data: settings, error: settingsError } = await supabase
      .from("llm_settings")
      .select("*")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (settingsError || !settings) {
      return createJsonResponse(req, { error: "Configure suas credenciais de LLM na aba Admin primeiro." }, 400);
    }

    const provider = normalizeProvider(settings.provider);
    if (!provider) {
      return createJsonResponse(req, { error: `Provider nao suportado: ${settings.provider}` }, 400);
    }

    const activeSettings: ActiveSettings = {
      provider,
      apiKey: settings.api_key,
      model: settings.model,
    };

    const billingSnapshot = await getBillingUsageSnapshot(supabase, authenticatedUser.id);
    if (!billingSnapshot) {
      return createJsonResponse(
        req,
        { code: "PROFILE_NOT_FOUND", message: "Perfil de billing nao encontrado para o usuario." },
        403,
      );
    }

    if (billingSnapshot.aces_id === null) {
      return createJsonResponse(
        req,
        {
          code: "USER_NOT_LINKED_TO_ACES",
          message: "Seu usuario nao esta vinculado a nenhuma empresa (aces_id).",
        },
        403,
      );
    }

    if (billingSnapshot.remaining_tokens <= USAGE_SAFETY_MARGIN_TOKENS) {
      return createJsonResponse(
        req,
        {
          code: "USAGE_LIMIT_REACHED",
          message: "Seu limite mensal foi atingido. Aguarde o proximo reset para continuar.",
          usage: buildUsagePayload(billingSnapshot),
        },
        429,
      );
    }

    const pricingExists = await hasActiveModelPricing(
      supabase,
      activeSettings.provider,
      activeSettings.model,
    );
    if (!pricingExists) {
      return createJsonResponse(
        req,
        {
          code: "MODEL_PRICING_NOT_FOUND",
          message: `Nao ha precificacao ativa para ${activeSettings.provider}:${activeSettings.model}.`,
        },
        500,
      );
    }

    let agentContext: { agent: any; tables: any[] } | null = null;
    if (agentId) {
      const { data: agent } = await supabase
        .from("agents")
        .select("*")
        .eq("id", agentId)
        .eq("user_id", authenticatedUser.id)
        .single();

      if (!agent) {
        return createJsonResponse(req, { error: "Agente nao encontrado para este usuario." }, 404);
      }

      const { data: agentTables } = await supabase
        .from("agent_tables")
        .select("*")
        .eq("agent_id", agentId);

      agentContext = { agent, tables: agentTables || [] };
    }

    const lastUserMessage = getLastUserMessage(messages);
    const userIntent = detectUserIntent(lastUserMessage);
    const chartAndInsightRequested = detectChartAndInsightIntent(lastUserMessage);
    let totalUsage = emptyUsage();

    const swarmResult = await runSwarmFlow({
      req,
      requestId,
      settings: activeSettings,
      messages,
      userMessage: lastUserMessage,
      userIntent,
      chartAndInsightRequested,
      supabaseUrl,
      supabaseServiceKey: supabaseKey,
      userAccessToken: accessToken!,
      internalProxyKey,
      sqlDebug: sqlDebugRequested,
    });

    totalUsage = mergeUsage(totalUsage, swarmResult.usage);
    const responseToReturn = swarmResult.response;

    const swarmMetadata: Record<string, unknown> = {
      swarm_enabled: true,
      swarm_handled: true,
      swarm_worker_count: swarmResult.selectedWorkers.length,
      swarm_workers: swarmResult.selectedWorkers,
      data_source: "delphi_proxy",
    };

    const usageMissing = totalUsage.totalTokens <= 0;
    console.log("[billing] Final aggregated usage before record:", {
      interactionId,
      provider: activeSettings.provider,
      model: activeSettings.model,
      usage: totalUsage,
      usage_missing: usageMissing,
    });

    await recordUsageEvent(supabase, {
      userId: authenticatedUser.id,
      conversationId,
      interactionId,
      provider: activeSettings.provider,
      model: activeSettings.model,
      usage: totalUsage,
      metadata: {
        user_intent: userIntent,
        chart_and_insight_requested: chartAndInsightRequested,
        agent_id: agentId,
        usage_missing: usageMissing,
        ...swarmMetadata,
      },
    });

    return responseToReturn;
  } catch (error) {
    console.error("Chat error:", error);

    if (error instanceof SwarmFlowError) {
      return createJsonResponse(
        req,
        {
          code: "SWARM_FLOW_FAILED",
          message: "Falha na orquestracao dos agentes.",
          reason: error.message,
        },
        503,
      );
    }

    if (error instanceof Error && error.message === "USER_NOT_LINKED_TO_ACES") {
      return createJsonResponse(
        req,
        {
          code: "USER_NOT_LINKED_TO_ACES",
          message: "Seu usuario nao esta vinculado a nenhuma empresa (aces_id).",
        },
        403,
      );
    }

    if (error instanceof Error && error.message === "USAGE_LIMIT_REACHED") {
      return createJsonResponse(
        req,
        {
          code: "USAGE_LIMIT_REACHED",
          message: "Seu limite mensal foi atingido. Aguarde o proximo reset para continuar.",
        },
        429,
      );
    }

    if (error instanceof Error && error.message === "MODEL_PRICING_NOT_FOUND") {
      return createJsonResponse(
        req,
        {
          code: "MODEL_PRICING_NOT_FOUND",
          message: "Nao ha precificacao ativa para o modelo configurado.",
        },
        500,
      );
    }

    if (error instanceof Error && error.message === "PROFILE_NOT_FOUND") {
      return createJsonResponse(
        req,
        {
          code: "PROFILE_NOT_FOUND",
          message: "Perfil de billing nao encontrado para o usuario.",
        },
        403,
      );
    }

    const errorMessage = error instanceof Error ? error.message : "Erro interno do servidor";
    return createJsonResponse(req, { error: errorMessage }, 500);
  }
}

if (import.meta.main) {
  serve(handleChatRequest);
}

function normalizeRequestMessages(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((message: any) => message && typeof message.role === "string" && typeof message.content === "string")
    .map((message: any) => ({
      role: normalizeRole(message.role),
      content: message.content,
    }));
}

function normalizeRole(role: string): string {
  if (role === "assistant" || role === "system") {
    return role;
  }
  return "user";
}

function getLastUserMessage(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user" && messages[index].content.trim()) {
      return messages[index].content.trim();
    }
  }
  return "";
}

function normalizeIntentText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasExplicitChartRequest(normalizedIntentText: string): boolean {
  if (!normalizedIntentText) return false;
  return (
    /\b(grafico|graficos|chart|charts|plot|plots|visualizacao|visualizacoes|dashboard|dashboards|pizza|barras|scatter|dispersao)\b/.test(
      normalizedIntentText,
    ) ||
    /\btendencia visual\b/.test(normalizedIntentText)
  );
}

export function shouldGenerateChartResponse(userIntent: UserIntent): boolean {
  return userIntent === "chart";
}

export function detectUserIntent(lastUserMessage: string): UserIntent {
  if (!lastUserMessage) {
    return "default";
  }

  const normalized = normalizeIntentText(lastUserMessage);

  const asksSql = /\b(sql|query|consulta)\b/.test(normalized);
  const asksToShow = /\b(mostrar|mostre|exibir|exiba|ver|veja|quero|forneca|fornecer|enviar|envie|passa|passe)\b/.test(
    normalized,
  );
  if (asksSql && asksToShow) {
    return "explicit_sql";
  }

  if (/^\s*(select|with)\b/.test(normalized)) {
    return "explicit_sql";
  }

  const asksChart = hasExplicitChartRequest(normalized);
  if (asksChart) {
    return "chart";
  }

  const asksInsight =
    /\b(analise|insight|resumo|tendencia|desempenho|diagnostico|explicar|avaliar|interpretar)\b/.test(
      normalized,
    ) || /\b(o que aconteceu|como foi)\b/.test(normalized);
  if (asksInsight) {
    return "insight";
  }

  return "default";
}

function isSalesQuestion(lastUserMessage: string): boolean {
  const normalized = normalizeIntentText(lastUserMessage || "");
  if (!normalized) {
    return false;
  }

  return /\b(venda|vendas|vendido|vendida|vendeu|vendedor|vendedores|faturamento|faturado|faturou|pedido|pedidos|receita)\b/.test(
    normalized,
  );
}

function asksBudgetIntent(userMessage: string): boolean {
  const normalized = normalizeIntentText(userMessage || "");
  if (!normalized) {
    return false;
  }
  return /\b(orcamento|orcamentos|cotacao|cotacoes)\b/.test(normalized);
}

function containsAtendimentoTable(tables: string): boolean {
  return /\bATENDIMENTO\b/i.test(tables || "");
}

function condHasAtenStTipoFilter(cond: string): boolean {
  return /\bATEN_STTIPO\b/i.test(cond || "");
}

function injectCondClausePreservingGroupBy(cond: string, clause: string): string {
  const groupByRegex = /\bGROUP\s+BY\b/i;
  const groupMatch = groupByRegex.exec(cond);
  if (!groupMatch) {
    return `${cond} AND ${clause}`.trim();
  }

  const splitIndex = groupMatch.index;
  const beforeGroup = cond.slice(0, splitIndex).trim();
  const afterGroup = cond.slice(splitIndex).trim();
  return `${beforeGroup} AND ${clause} ${afterGroup}`.trim();
}

function extractAtendimentoQualifier(tables: string): string {
  const source = (tables || "").trim();
  const fromMatch = source.match(/\bATENDIMENTO\b(?:\s+(?:AS\s+)?([A-Z0-9_]+))?/i);
  const alias = fromMatch?.[1];
  if (!alias || /^(LEFT|RIGHT|INNER|FULL|CROSS|JOIN|ON|WHERE|GROUP|ORDER|HAVING)$/i.test(alias)) {
    return "ATENDIMENTO";
  }
  return alias;
}

function applySwarmGuardrailToQueryPayload(
  payload: SwarmQueryPayload,
  userMessage: string,
): { payload: SwarmQueryPayload; atendimentoTipoApplied: boolean; reason: string } {
  if (!containsAtendimentoTable(payload.tables)) {
    return { payload, atendimentoTipoApplied: false, reason: "no_atendimento_table" };
  }

  if (asksBudgetIntent(userMessage)) {
    return { payload, atendimentoTipoApplied: false, reason: "budget_intent" };
  }

  if (condHasAtenStTipoFilter(payload.cond)) {
    return { payload, atendimentoTipoApplied: false, reason: "already_filtered" };
  }

  const qualifier = extractAtendimentoQualifier(payload.tables);
  const guarded: SwarmQueryPayload = {
    ...payload,
    cond: injectCondClausePreservingGroupBy(payload.cond, `${qualifier}.ATEN_STTIPO <> 'O'`),
  };
  return { payload: guarded, atendimentoTipoApplied: true, reason: "guardrail_injected" };
}

function toNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.replace(/\./g, "").replace(",", ".").trim();
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function toIntValue(value: unknown): number | null {
  const parsed = toNumericValue(value);
  if (parsed === null) return null;
  const rounded = Math.round(parsed);
  return Number.isFinite(rounded) ? rounded : null;
}

function findCaseInsensitiveKey(row: Record<string, unknown>, target: string): string | null {
  const keys = Object.keys(row);
  const lowerTarget = target.toLowerCase();
  const found = keys.find((key) => key.toLowerCase() === lowerTarget);
  return found || null;
}

function pickPrimaryMetricKey(rows: Record<string, unknown>[], excludedKeys: Set<string>): string | null {
  if (!rows.length) return null;
  const sample = rows[0];
  const candidateKeys = Object.keys(sample).filter((key) => !excludedKeys.has(key.toLowerCase()));
  const numericKeys = candidateKeys.filter((key) => toNumericValue(sample[key]) !== null);
  if (!numericKeys.length) return null;

  const preferred = numericKeys.find((key) => /\b(total|venda|valor)\b/i.test(key));
  if (preferred) return preferred;
  return numericKeys[0];
}

function normalizeChartDatasetForYearMonth(rows: Record<string, unknown>[]): {
  rows: Record<string, unknown>[];
  applied: boolean;
  metricKey?: string;
} {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { rows, applied: false };
  }

  const sample = rows[0];
  const yearKey = findCaseInsensitiveKey(sample, "Ano");
  const monthKey = findCaseInsensitiveKey(sample, "Mes");
  if (!yearKey || !monthKey) {
    return { rows, applied: false };
  }

  const excludedKeys = new Set([yearKey.toLowerCase(), monthKey.toLowerCase()]);
  const metricKey = pickPrimaryMetricKey(rows, excludedKeys);
  if (!metricKey) {
    return { rows, applied: false };
  }

  const transformed: Record<string, unknown>[] = [];
  for (const row of rows) {
    const year = toIntValue(row[yearKey]);
    const month = toIntValue(row[monthKey]);
    const metric = toNumericValue(row[metricKey]);

    if (year === null || month === null || metric === null || month < 1 || month > 12) {
      return { rows, applied: false };
    }

    const mm = String(month).padStart(2, "0");
    transformed.push({
      Periodo: `${year}-${mm}`,
      [metricKey]: metric,
    });
  }

  return {
    rows: transformed,
    applied: true,
    metricKey,
  };
}

function isIndexChartNormalizationFallbackEnabled(): boolean {
  const raw = Deno.env.get("INDEX_CHART_NORMALIZATION_FALLBACK");
  if (!raw) return true;
  const normalized = raw.trim().toLowerCase();
  return normalized !== "0" && normalized !== "false" && normalized !== "off" && normalized !== "no";
}

function detectChartAndInsightIntent(lastUserMessage: string): boolean {
  const normalized = normalizeIntentText(lastUserMessage || "");
  if (!normalized) {
    return false;
  }

  const asksChart = hasExplicitChartRequest(normalized);

  const asksInsight =
    /\b(analise|analisar|insight|resumo|tendencia|desempenho|diagnostico|explicar|avaliar|interpretar)\b/.test(
      normalized,
    ) || /\b(comentario|comente|conclusao)\b/.test(normalized);

  return asksChart && asksInsight;
}

function sanitizeProviderErrorSnippet(detail?: string, maxLength = 220): string | null {
  if (typeof detail !== "string") return null;
  const normalized = detail.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

export async function generateSqlQueryWithRetry(params: {
  userMessage: string;
  activeSchemas: string;
  requestId?: string;
  maxRetries?: number;
  queryFn?: typeof generateSqlQuery;
}): Promise<{ queryPayload: QueryGeneratorOutput; usage: TokenUsage; attempts: number }> {
  const { userMessage, activeSchemas, requestId, queryFn = generateSqlQuery } = params;
  const maxRetries = Math.max(0, params.maxRetries ?? QUERY_GENERATOR_MAX_RETRIES);
  const totalAttempts = maxRetries + 1;
  let totalUsage = emptyUsage();
  let lastPayload: QueryGeneratorOutput | null = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const payload = await queryFn({ userMessage, activeSchemas });
    totalUsage = mergeUsage(totalUsage, payload.usage);
    lastPayload = payload;

    if (!payload.shouldFallback) {
      return { queryPayload: payload, usage: totalUsage, attempts: attempt };
    }

    const canRetry = attempt < totalAttempts && (payload.retriable ?? true);
    const logPayload = {
      request_id: requestId ?? null,
      attempt,
      reason_code: payload.failureCode ?? "unknown_failure",
      http_status: payload.failureHttpStatus ?? null,
      retriable: payload.retriable ?? null,
      provider_error_snippet: sanitizeProviderErrorSnippet(payload.failureDetail),
    };

    if (canRetry) {
      console.warn("[chat][swarm][query_generator_failed_retrying]", logPayload);
      continue;
    }

    console.error("[chat][swarm][query_generator_failed_final]", logPayload);
    return { queryPayload: payload, usage: totalUsage, attempts: attempt };
  }

  return {
    queryPayload: lastPayload || {
      error: "Falha interna ao montar consulta SQL Server.",
      usage: emptyUsage(),
      shouldFallback: true,
      failureCode: "unexpected_error",
      failureDetail: "Retry loop concluido sem payload final valido.",
      retriable: false,
    },
    usage: totalUsage,
    attempts: totalAttempts,
  };
}

export async function invokeDelphiProxy(
  supabaseUrl: string,
  supabaseServiceKey: string,
  userAccessToken: string,
  internalProxyKey: string,
  payload: DelphiProxyPayload,
): Promise<DelphiProxyResult> {
  const baseUrl = supabaseUrl.endsWith("/") ? supabaseUrl.slice(0, -1) : supabaseUrl;
  const proxyUrl = `${baseUrl}/functions/v1/external-db-proxy`;
  const response = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${userAccessToken}`,
      "x-internal-proxy-key": internalProxyKey,
    },
    body: JSON.stringify(payload),
  });

  const rawBody = await response.text();
  const parsed = safeJsonParse(rawBody);

  if (!response.ok) {
    const remoteError = typeof parsed?.error === "string" ? parsed.error : "";
    const message = remoteError || `Falha no proxy Delphi (status ${response.status}).`;
    throw new Error(message);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Resposta invalida do proxy Delphi.");
  }

  const proxyPayload = parsed as DelphiProxyResult;
  if (!proxyPayload.success) {
    throw new Error(proxyPayload.error || "Proxy Delphi retornou erro.");
  }

  return proxyPayload;
}

async function runSwarmFlow(params: {
  req: Request;
  requestId: string;
  settings: ActiveSettings;
  messages: ChatMessage[];
  userMessage: string;
  userIntent: UserIntent;
  chartAndInsightRequested: boolean;
  supabaseUrl: string;
  supabaseServiceKey: string;
  userAccessToken: string;
  internalProxyKey: string;
  sqlDebug: boolean;
}): Promise<SwarmFlowResult> {
  const {
    req,
    requestId,
    settings,
    messages,
    userMessage,
    userIntent,
    chartAndInsightRequested,
    supabaseUrl,
    supabaseServiceKey,
    userAccessToken,
    internalProxyKey,
    sqlDebug,
  } = params;

  let usage = emptyUsage();

  try {
    const supervisorResult = await routeToSpecialist({
      userMessage,
      chatHistory: messages.slice(-12),
    });
    usage = mergeUsage(usage, supervisorResult.usage);

    if (supervisorResult.shouldFallback) {
      throw new SwarmFlowError("SWARM_SUPERVISOR_FAILED", usage);
    }

    if (!supervisorResult.selectedWorkers.length) {
      const textResponse = await callProvider(
        settings,
        "Voce e um assistente virtual orientado por negocio. Responda de forma clara e objetiva.",
        messages,
        { withTools: false },
      );
      usage = mergeUsage(usage, textResponse.usage);

      const content =
        textResponse.result.type === "text"
          ? sanitizeUserFacingText(textResponse.result.text, false)
          : "Posso te ajudar com dados de negocio. O que voce gostaria de analisar?";

      return {
        response: createTextSseResponse(req, content),
        usage,
        selectedWorkers: [],
      };
    }

    const activeSchemas = resolveSchemas(supervisorResult.selectedWorkers);
    if (!activeSchemas.trim()) {
      throw new SwarmFlowError("SWARM_SCHEMA_RESOLUTION_EMPTY", usage);
    }

    const queryAttempt = await generateSqlQueryWithRetry({
      userMessage,
      activeSchemas,
      requestId,
      maxRetries: QUERY_GENERATOR_MAX_RETRIES,
    });
    usage = mergeUsage(usage, queryAttempt.usage);
    const queryPayload = queryAttempt.queryPayload;

    if (queryPayload.shouldFallback) {
      return {
        response: createTextSseResponse(req, QUERY_GENERATOR_USER_FRIENDLY_ERROR),
        usage,
        selectedWorkers: supervisorResult.selectedWorkers,
      };
    }

    if (queryPayload.error) {
      return {
        response: createTextSseResponse(req, queryPayload.error),
        usage,
        selectedWorkers: supervisorResult.selectedWorkers,
      };
    }

    if (!queryPayload.fields || !queryPayload.tables || !queryPayload.cond) {
      throw new SwarmFlowError("SWARM_QUERY_GENERATOR_INCOMPLETE", usage);
    }

    const shouldGenerateChart = shouldGenerateChartResponse(userIntent);
    let effectiveQueryPayload: SwarmQueryPayload = {
      fields: queryPayload.fields,
      tables: queryPayload.tables,
      cond: queryPayload.cond,
      order: queryPayload.order,
      rowspPage: queryPayload.rowspPage,
      chart_type: shouldGenerateChart ? queryPayload.chart_type : undefined,
      chart_title: shouldGenerateChart ? queryPayload.chart_title : undefined,
    };
    console.log("[chat][swarm] data_source=delphi_proxy", {
      workers: supervisorResult.selectedWorkers,
      query_payload: {
        fields: effectiveQueryPayload.fields,
        tables: effectiveQueryPayload.tables,
        cond: effectiveQueryPayload.cond,
        order: effectiveQueryPayload.order ?? null,
        rowspPage: effectiveQueryPayload.rowspPage ?? null,
      },
    });

    const initialGuardrail = applySwarmGuardrailToQueryPayload(effectiveQueryPayload, userMessage);
    effectiveQueryPayload = initialGuardrail.payload;
    console.log(
      `[SWARM_GUARDRAIL] atendimentoTipoApplied=${initialGuardrail.atendimentoTipoApplied} reason=${initialGuardrail.reason}`,
    );

    let proxyResult = await invokeDelphiProxy(supabaseUrl, supabaseServiceKey, userAccessToken, internalProxyKey, {
      fields: effectiveQueryPayload.fields,
      tables: effectiveQueryPayload.tables,
      cond: effectiveQueryPayload.cond,
      order: effectiveQueryPayload.order,
      rowspPage: effectiveQueryPayload.rowspPage,
    });

    let queryData = Array.isArray(proxyResult.data) ? proxyResult.data : [];
    const shouldRetryForSales = isSalesQuestion(userMessage);

    if (shouldRetryForSales && queryData.length === 0) {
      console.log("[chat][swarm][retry] reason=empty_result_for_sales");
      const retryPrompt =
        `${userMessage}\n\n` +
        "INSTRUCOES DE QUALIDADE (obrigatorio):\n" +
        "- Use tabela de vendas ATENDIMENTO quando aplicavel.\n" +
        "- Aplique filtros de ativos (_ID_DEL IS NULL) e exclua orcamentos por padrao.\n" +
        "- Mantenha ORDER BY explicito por coluna/alias.\n" +
        "- Evite consultas que dependam de tabelas fora do dicionario atual.";

      const retryQueryPayload = await generateSqlQuery({
        userMessage: retryPrompt,
        activeSchemas,
      });
      usage = mergeUsage(usage, retryQueryPayload.usage);

      if (!retryQueryPayload.shouldFallback && !retryQueryPayload.error &&
          retryQueryPayload.fields && retryQueryPayload.tables && retryQueryPayload.cond) {
        effectiveQueryPayload = {
          fields: retryQueryPayload.fields,
          tables: retryQueryPayload.tables,
          cond: retryQueryPayload.cond,
          order: retryQueryPayload.order,
          rowspPage: retryQueryPayload.rowspPage,
          chart_type: shouldGenerateChart ? retryQueryPayload.chart_type : undefined,
          chart_title: shouldGenerateChart ? retryQueryPayload.chart_title : undefined,
        };
        const retryGuardrail = applySwarmGuardrailToQueryPayload(effectiveQueryPayload, userMessage);
        effectiveQueryPayload = retryGuardrail.payload;
        console.log("[chat][swarm][retry] data_source=delphi_proxy", {
          workers: supervisorResult.selectedWorkers,
          query_payload: {
            fields: effectiveQueryPayload.fields,
            tables: effectiveQueryPayload.tables,
            cond: effectiveQueryPayload.cond,
            order: effectiveQueryPayload.order ?? null,
            rowspPage: effectiveQueryPayload.rowspPage ?? null,
          },
        });
        console.log(
          `[SWARM_GUARDRAIL] atendimentoTipoApplied=${retryGuardrail.atendimentoTipoApplied} reason=${retryGuardrail.reason}`,
        );

        proxyResult = await invokeDelphiProxy(supabaseUrl, supabaseServiceKey, userAccessToken, internalProxyKey, {
          fields: effectiveQueryPayload.fields,
          tables: effectiveQueryPayload.tables,
          cond: effectiveQueryPayload.cond,
          order: effectiveQueryPayload.order,
          rowspPage: effectiveQueryPayload.rowspPage,
        });
        queryData = Array.isArray(proxyResult.data) ? proxyResult.data : [];
      }
    }

    if (shouldRetryForSales && queryData.length === 0) {
      return {
        response: createTextSseResponse(
          req,
          "Nao encontrei vendas para os filtros solicitados no periodo informado. Posso ajustar o periodo ou abrir por vendedor, produto ou loja para localizar os dados.",
        ),
        usage,
        selectedWorkers: supervisorResult.selectedWorkers,
      };
    }

    const sqlDebugQuery = sqlDebug
      ? buildSqlDebugQuery({
          fields: effectiveQueryPayload.fields,
          tables: effectiveQueryPayload.tables,
          cond: effectiveQueryPayload.cond,
          order: effectiveQueryPayload.order,
        })
      : undefined;

    if (shouldGenerateChart) {
      let chartRows = queryData;
      if (isIndexChartNormalizationFallbackEnabled()) {
        const normalizedChartData = normalizeChartDatasetForYearMonth(queryData);
        chartRows = normalizedChartData.rows;
        if (normalizedChartData.applied) {
          console.log(
            `[CHART_DATA_NORMALIZED] mode=year_month_to_period metric=${normalizedChartData.metricKey || "unknown"} rows=${chartRows.length} fallback=index`,
          );
        }
      }

      const chartArgs: ChartToolArgs = {
        sql_query: `SELECT ${effectiveQueryPayload.fields} FROM ${effectiveQueryPayload.tables}`,
        chart_type: effectiveQueryPayload.chart_type || "bar",
        chart_title: effectiveQueryPayload.chart_title || "Analise de Dados",
      };

      const pythonResponse = await generateChartFromPython(chartRows, chartArgs);
      const pythonPayload =
        sqlDebugQuery
          ? { ...pythonResponse, sql_debug: sqlDebugQuery }
          : pythonResponse;

      if (chartAndInsightRequested) {
        const insightArgs = buildInsightArgsFromChartRequest(userMessage);
        const insightSynthesis = await synthesizeInsightText(settings, userMessage, insightArgs, queryData);
        usage = mergeUsage(usage, insightSynthesis.usage);

        const chartInsightPayload: ChartInsightContentPayload = {
          success: true,
          row_count: queryData.length,
          chart_payload: pythonPayload,
          insight_text: insightSynthesis.text,
          analysis_scope: insightArgs.analysis_scope,
          analysis_focus: insightArgs.analysis_focus,
          warnings: extractChartWarnings(pythonResponse),
          sql_debug: sqlDebugQuery,
        };

        return {
          response: createChartInsightSseResponse(req, chartInsightPayload),
          usage,
          selectedWorkers: supervisorResult.selectedWorkers,
        };
      }

      return {
        response: createChartSseResponse(req, pythonPayload),
        usage,
        selectedWorkers: supervisorResult.selectedWorkers,
      };
    }

    const insightArgs = buildInsightArgsFromChartRequest(userMessage);
    const insightSynthesis = await synthesizeInsightText(settings, userMessage, insightArgs, queryData);
    usage = mergeUsage(usage, insightSynthesis.usage);

    const rows = queryData.slice(0, MAX_INSIGHT_ROWS);
    const payload: InsightContentPayload = {
      success: true,
      analysis_scope: insightArgs.analysis_scope,
      analysis_focus: insightArgs.analysis_focus,
      row_count: queryData.length,
      columns: inferColumns(rows),
      rows,
      insight_text: insightSynthesis.text,
      sql_debug: sqlDebugQuery,
    };

    return {
      response: createInsightSseResponse(req, payload),
      usage,
      selectedWorkers: supervisorResult.selectedWorkers,
    };
  } catch (error) {
    if (error instanceof SwarmFlowError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "SWARM_FLOW_FAILED";
    throw new SwarmFlowError(message, usage);
  }
}

function buildInsightArgsFromChartRequest(userQuestion: string): InsightToolArgs {
  const normalized = normalizeIntentText(userQuestion || "");
  const asksDeepAnalysis =
    /\b(analise|analisar|insight|resumo|diagnostico|desempenho|tendencia|avaliar|interpretar|compar)\b/.test(
      normalized,
    );
  const looksDirectQuestion =
    /\b(qual|quanto|quantos|quando|onde|quem)\b/.test(normalized) && !asksDeepAnalysis;

  const analysisScope: InsightScope = looksDirectQuestion ? "specific" : "broad";
  const focusText = (userQuestion || "").trim();
  const analysisFocus = focusText
    ? `Analise do grafico: ${ focusText.slice(0, 180) }`
    : "Analise de negocio baseada no grafico";

  return {
    sql_query: "",
    analysis_scope: analysisScope,
    analysis_focus: analysisFocus,
  };
}

function normalizeProvider(provider: unknown): ProviderName | null {
  if (typeof provider !== "string") {
    return null;
  }

  const normalized = provider.trim().toLowerCase();

  if (normalized === "openai") {
    return "openai";
  }

  // Backward compatibility with older settings saved as "google".
  if (normalized === "gemini" || normalized === "google") {
    return "gemini";
  }

  return null;
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token.trim() || null;
}

async function authenticateRequestUser(accessToken: string | null, supabase: any): Promise<AuthenticatedUser | null> {
  if (!accessToken) {
    return null;
  }

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data?.user) {
    console.warn("Chat auth failed:", error?.message || "missing user");
    return null;
  }

  return {
    id: data.user.id,
  };
}

function createJsonResponse(
  req: Request,
  payload: Record<string, unknown>,
  status: number,
  extraHeaders: HeadersInit = {},
): Response {
  const origin = req.headers.get("origin");
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...createCorsHeaders(origin),
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

function toSafeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function toSafeTokenCount(value: unknown): number {
  return Math.max(0, Math.round(toSafeNumber(value)));
}

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function mergeUsage(base: TokenUsage, next: TokenUsage): TokenUsage {
  return {
    inputTokens: base.inputTokens + next.inputTokens,
    outputTokens: base.outputTokens + next.outputTokens,
    totalTokens: base.totalTokens + next.totalTokens,
  };
}

function extractOpenAIUsage(rawUsage: any): TokenUsage {
  const inputTokens = toSafeTokenCount(rawUsage?.prompt_tokens);
  const outputTokens = toSafeTokenCount(rawUsage?.completion_tokens);
  const totalTokensRaw = toSafeTokenCount(rawUsage?.total_tokens);
  const totalTokens = totalTokensRaw > 0 ? totalTokensRaw : inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

function extractGeminiUsage(rawUsage: any): TokenUsage {
  const inputTokens = toSafeTokenCount(
    rawUsage?.promptTokenCount ??
    rawUsage?.prompt_token_count ??
    rawUsage?.promptTokens ??
    rawUsage?.inputTokenCount ??
    rawUsage?.input_tokens,
  );
  const outputTokens = toSafeTokenCount(
    rawUsage?.candidatesTokenCount ??
    rawUsage?.candidates_token_count ??
    rawUsage?.candidatesTokens ??
    rawUsage?.outputTokenCount ??
    rawUsage?.output_tokens,
  );
  const totalTokensRaw = toSafeTokenCount(
    rawUsage?.totalTokenCount ??
    rawUsage?.total_token_count ??
    rawUsage?.totalTokens ??
    rawUsage?.tokenCount,
  );
  const totalTokens = totalTokensRaw > 0 ? totalTokensRaw : inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

function normalizeBillingUsageSnapshot(raw: any): BillingUsageSnapshot {
  return {
    user_id: String(raw?.user_id ?? ""),
    aces_id: raw?.aces_id === null || raw?.aces_id === undefined ? null : toSafeNumber(raw.aces_id),
    plan_id: String(raw?.plan_id ?? ""),
    plan_name: String(raw?.plan_name ?? "Plano"),
    monthly_token_limit: toSafeTokenCount(raw?.monthly_token_limit),
    monthly_credit_limit: toSafeTokenCount(raw?.monthly_credit_limit),
    cycle_start_at: String(raw?.cycle_start_at ?? ""),
    cycle_end_at: String(raw?.cycle_end_at ?? ""),
    tokens_used: toSafeTokenCount(raw?.tokens_used),
    credits_used: toSafeNumber(raw?.credits_used),
    usd_spent: toSafeNumber(raw?.usd_spent),
    usage_percent: toSafeNumber(raw?.usage_percent),
    remaining_tokens: toSafeTokenCount(raw?.remaining_tokens),
    remaining_credits: toSafeNumber(raw?.remaining_credits),
  };
}

function buildUsagePayload(snapshot: BillingUsageSnapshot): Record<string, unknown> {
  return {
    usedCredits: snapshot.credits_used,
    limitCredits: snapshot.monthly_credit_limit,
    percent: snapshot.usage_percent,
    cycleEndAt: snapshot.cycle_end_at,
  };
}

async function getBillingUsageSnapshot(
  supabase: any,
  userId: string,
): Promise<BillingUsageSnapshot | null> {
  const { data, error } = await supabase.rpc("billing_get_usage_snapshot", {
    p_user_id: userId,
    p_reference_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(error.message || "Falha ao carregar snapshot de billing.");
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return null;
  }

  return normalizeBillingUsageSnapshot(row);
}

async function hasActiveModelPricing(
  supabase: any,
  provider: ProviderName,
  model: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("llm_model_pricing")
    .select("id")
    .eq("provider", provider)
    .eq("model", model)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao consultar precificacao do modelo.");
  }

  return Boolean(data?.id);
}

async function recordUsageEvent(
  supabase: any,
  params: {
    userId: string;
    conversationId: string | null;
    interactionId: string;
    provider: ProviderName;
    model: string;
    usage: TokenUsage;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.rpc("billing_record_usage", {
    p_user_id: params.userId,
    p_conversation_id: params.conversationId,
    p_interaction_id: params.interactionId,
    p_provider: params.provider,
    p_model: params.model,
    p_input_tokens: params.usage.inputTokens,
    p_output_tokens: params.usage.outputTokens,
    p_reference_at: new Date().toISOString(),
    p_metadata: params.metadata,
  });

  if (!error) {
    return;
  }

  const message = error.message || "BILLING_RECORD_FAILED";

  if (message.includes("USER_NOT_LINKED_TO_ACES")) {
    throw new Error("USER_NOT_LINKED_TO_ACES");
  }

  if (message.includes("USAGE_LIMIT_REACHED")) {
    throw new Error("USAGE_LIMIT_REACHED");
  }

  if (message.includes("MODEL_PRICING_NOT_FOUND")) {
    throw new Error("MODEL_PRICING_NOT_FOUND");
  }

  if (message.includes("PROFILE_NOT_FOUND")) {
    throw new Error("PROFILE_NOT_FOUND");
  }

  throw new Error(`BILLING_RECORD_FAILED: ${message}`);
}

async function callProvider(
  settings: ActiveSettings,
  systemPrompt: string,
  messages: ChatMessage[],
  options: LLMCallOptions = {},
): Promise<LLMProviderResponse> {
  if (settings.provider === "openai") {
    return await callOpenAI(settings.apiKey, settings.model, systemPrompt, messages, options);
  }
  return await callGemini(settings.apiKey, settings.model, systemPrompt, messages, options);
}

async function callOpenAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  options: LLMCallOptions = {},
): Promise<LLMProviderResponse> {
  return await callOpenAIInternal(apiKey, model, systemPrompt, messages, options);
}

async function callOpenAIInternal(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  options: LLMCallOptions,
): Promise<LLMProviderResponse> {
  const withTools = options.withTools ?? true;
  const forceToolName = options.forceToolName ?? null;

  const requestBody: Record<string, unknown> = {
    model,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    stream: false,
  };

  if (typeof options.temperature === "number") {
    requestBody.temperature = options.temperature;
  }

  if (withTools) {
    requestBody.tools = OPENAI_TOOLS;
    requestBody.tool_choice = forceToolName
      ? { type: "function", function: { name: forceToolName } }
      : "auto";
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const rawBody = await response.text();
  if (!response.ok) {
    if (withTools && !forceToolName && shouldRetryWithoutTools(response.status, rawBody)) {
      console.warn("OpenAI rejected tools payload, retrying without tools.");
      return await callOpenAIInternal(apiKey, model, systemPrompt, messages, { ...options, withTools: false });
    }
    throw new Error(`Erro OpenAI(${response.status}): ${extractProviderError(rawBody)}`);
  }

  const payload = safeJsonParse(rawBody) || {};
  const usage = extractOpenAIUsage(payload?.usage);
  const message = payload?.choices?.[0]?.message;

  if (withTools) {
    const toolResult = extractOpenAIToolResult(message?.tool_calls);
    if (toolResult) {
      return { result: toolResult, usage };
    }
  }

  const text = extractOpenAIText(message?.content);
  return {
    result: { type: "text", text: text || "Desculpe, nao consegui gerar uma resposta no momento." },
    usage,
  };
}

async function callGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  options: LLMCallOptions = {},
): Promise<LLMProviderResponse> {
  return await callGeminiInternal(apiKey, model, systemPrompt, messages, options);
}

async function callGeminiInternal(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  options: LLMCallOptions,
): Promise<LLMProviderResponse> {
  const withTools = options.withTools ?? true;
  const forceToolName = options.forceToolName ?? null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contents = messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));

  const requestBody: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
  };

  if (typeof options.temperature === "number") {
    requestBody.generationConfig = { temperature: options.temperature };
  }

  if (withTools) {
    requestBody.tools = GEMINI_TOOLS;
    requestBody.toolConfig = forceToolName
      ? {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: [forceToolName],
        },
      }
      : { functionCallingConfig: { mode: "AUTO" } };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  const rawBody = await response.text();
  if (!response.ok) {
    if (withTools && !forceToolName && shouldRetryWithoutTools(response.status, rawBody)) {
      console.warn("Gemini rejected tools payload, retrying without tools.");
      return await callGeminiInternal(apiKey, model, systemPrompt, messages, { ...options, withTools: false });
    }
    throw new Error(`Erro Gemini (${response.status}): ${extractProviderError(rawBody)}`);
  }

  const payload = safeJsonParse(rawBody) || {};
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const rawGeminiUsage =
    payload?.usageMetadata ||
    payload?.usage_metadata ||
    payload?.usage ||
    payload?.metadata?.usage ||
    null;
  const usage = extractGeminiUsage(rawGeminiUsage);
  console.log("[billing] Gemini raw usage metadata:", rawGeminiUsage);
  console.log("[billing] Gemini parsed usage:", usage);

  if (withTools) {
    const toolResult = extractGeminiToolResult(parts);
    if (toolResult) {
      return { result: toolResult, usage };
    }
  }

  const text = extractGeminiText(parts);
  return {
    result: { type: "text", text: text || "Desculpe, nao consegui gerar uma resposta no momento." },
    usage,
  };
}

function extractOpenAIToolResult(toolCalls: any[]): LLMResult | null {
  if (!Array.isArray(toolCalls)) {
    return null;
  }

  for (const toolCall of toolCalls) {
    const toolName = toolCall?.function?.name;
    const rawArgs = toolCall?.function?.arguments;
    const parsedArgs = typeof rawArgs === "string" ? safeJsonParse(rawArgs) : rawArgs;

    if (toolName === "generate_chart") {
      const normalized = normalizeChartToolArgs(parsedArgs);
      if (normalized) {
        return { type: "tool_call_chart", args: normalized };
      }
    }

    if (toolName === "generate_insight") {
      const normalized = normalizeInsightToolArgs(parsedArgs);
      if (normalized) {
        return { type: "tool_call_insight", args: normalized };
      }
    }
  }

  return null;
}

function extractGeminiToolResult(parts: any[]): LLMResult | null {
  if (!Array.isArray(parts)) {
    return null;
  }

  for (const part of parts) {
    const functionCall = part?.functionCall || part?.function_call;
    if (!functionCall) {
      continue;
    }

    const toolName = functionCall.name;
    const rawArgs = functionCall.args ?? functionCall.arguments;
    const parsedArgs = typeof rawArgs === "string" ? safeJsonParse(rawArgs) : rawArgs;

    if (toolName === "generate_chart") {
      const normalized = normalizeChartToolArgs(parsedArgs);
      if (normalized) {
        return { type: "tool_call_chart", args: normalized };
      }
    }

    if (toolName === "generate_insight") {
      const normalized = normalizeInsightToolArgs(parsedArgs);
      if (normalized) {
        return { type: "tool_call_insight", args: normalized };
      }
    }
  }

  return null;
}

function normalizeChartToolArgs(rawArgs: any): ChartToolArgs | null {
  if (!rawArgs || typeof rawArgs !== "object") {
    return null;
  }

  const rawSql = typeof rawArgs.sql_query === "string" ? rawArgs.sql_query : "";
  const sqlQuery = sanitizeSqlQuery(rawSql);
  if (!sqlQuery) {
    return null;
  }

  const chartTypeInput =
    typeof rawArgs.chart_type === "string" ? rawArgs.chart_type.trim().toLowerCase() : "bar";
  const chartType = CHART_TYPES.includes(chartTypeInput as ChartType)
    ? (chartTypeInput as ChartType)
    : "bar";

  const chartTitle =
    typeof rawArgs.chart_title === "string" && rawArgs.chart_title.trim()
      ? rawArgs.chart_title.trim()
      : "Analise de dados";

  return {
    sql_query: sqlQuery,
    chart_type: chartType,
    chart_title: chartTitle,
  };
}

function normalizeInsightToolArgs(rawArgs: any): InsightToolArgs | null {
  if (!rawArgs || typeof rawArgs !== "object") {
    return null;
  }

  const rawSql = typeof rawArgs.sql_query === "string" ? rawArgs.sql_query : "";
  const sqlQuery = sanitizeSqlQuery(rawSql);
  if (!sqlQuery) {
    return null;
  }

  const rawScope =
    typeof rawArgs.analysis_scope === "string" ? rawArgs.analysis_scope.trim().toLowerCase() : "broad";
  const analysisScope: InsightScope = INSIGHT_SCOPES.includes(rawScope as InsightScope)
    ? (rawScope as InsightScope)
    : "broad";

  const analysisFocus =
    typeof rawArgs.analysis_focus === "string" && rawArgs.analysis_focus.trim()
      ? rawArgs.analysis_focus.trim()
      : "Analise geral de negocio";

  return {
    sql_query: sqlQuery,
    analysis_scope: analysisScope,
    analysis_focus: analysisFocus,
  };
}

function extractOpenAIText(content: any): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => (item?.type === "text" && typeof item.text === "string" ? item.text : ""))
      .join("");
  }

  return "";
}

function extractGeminiText(parts: any[]): string {
  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("");
}

function shouldRetryWithoutTools(status: number, rawBody: string): boolean {
  if (status !== 400 && status !== 404 && status !== 422) {
    return false;
  }

  const lowered = rawBody.toLowerCase();
  const toolErrorMarkers = [
    "tool",
    "tools",
    "function",
    "functiondeclarations",
    "tool_choice",
    "unsupported",
    "not supported",
    "unknown field",
  ];

  return toolErrorMarkers.some((marker) => lowered.includes(marker));
}

function extractProviderError(rawBody: string): string {
  const parsed = safeJsonParse(rawBody);
  if (!parsed) {
    return rawBody || "Erro desconhecido do provedor.";
  }

  if (typeof parsed?.error?.message === "string") {
    return parsed.error.message;
  }

  if (typeof parsed?.message === "string") {
    return parsed.message;
  }

  return JSON.stringify(parsed);
}

function sanitizeSqlQuery(query: string): string {
  let sanitized = query.trim();
  sanitized = sanitized.replace(/^```sql\s*/i, "").replace(/^```/i, "");
  sanitized = sanitized.replace(/```$/i, "").trim();
  sanitized = sanitized.replace(/;+\s*$/, "");
  return sanitized;
}

async function synthesizeInsightText(
  settings: ActiveSettings,
  userQuestion: string,
  insightArgs: InsightToolArgs,
  queryData: Record<string, unknown>[],
): Promise<{ text: string; usage: TokenUsage }> {
  const limitedRows = queryData.slice(0, MAX_INSIGHT_ROWS);
  const truncated = queryData.length > MAX_INSIGHT_ROWS;

  const synthesisSystemPrompt = buildInsightSynthesisPrompt(insightArgs.analysis_scope);
  const datasetPayload = {
    row_count: queryData.length,
    included_rows: limitedRows.length,
    truncated,
    columns: inferColumns(limitedRows),
    data: limitedRows,
    analysis_focus: insightArgs.analysis_focus,
  };

  const synthesisMessages: ChatMessage[] = [
    {
      role: "user",
      content:
        `Pergunta original do usuario: ${userQuestion || "Nao informada"}\n` +
        `Foco da analise: ${insightArgs.analysis_focus}\n` +
        `Escopo esperado: ${insightArgs.analysis_scope}\n\n` +
        `Dados retornados do backend (JSON):\n${JSON.stringify(datasetPayload)}`,
    },
  ];

  const synthesisResponse = await callProvider(
    settings,
    synthesisSystemPrompt,
    synthesisMessages,
    {
      withTools: false,
      temperature: INSIGHT_TEMPERATURE,
    },
  );

  if (synthesisResponse.result.type !== "text") {
    throw new Error("A sintese de insight retornou formato inesperado.");
  }

  const cleaned = sanitizeInsightNarrative(synthesisResponse.result.text);
  if (cleaned) {
    return {
      text: ensureInsightClosingBlock(cleaned, insightArgs.analysis_focus),
      usage: synthesisResponse.usage,
    };
  }

  if (queryData.length === 0) {
    return {
      text: ensureInsightClosingBlock(
        "Nao encontrei registros para essa analise no periodo informado. Posso revisar os filtros e tentar outra abordagem.",
        insightArgs.analysis_focus,
      ),
      usage: synthesisResponse.usage,
    };
  }

  return {
    text: ensureInsightClosingBlock(
      "Nao foi possivel concluir a sintese analitica no momento, mas os dados foram processados com sucesso.",
      insightArgs.analysis_focus,
    ),
    usage: synthesisResponse.usage,
  };
}

function buildInsightSynthesisPrompt(scope: InsightScope): string {
  return `Voce e um analista de negocio senior orientado por dados.

Voce deve adaptar o tamanho e a estrutura da sua resposta com base na amplitude da pergunta do usuario:
- Para perguntas amplas/exploratorias (ex: "Analise as vendas do ano"): Use uma estrutura executiva completa (Observacoes Principais, Implicacoes de Negocio, Acoes Sugeridas).
- Para perguntas especificas/diretas (ex: "Qual foi o mes com maior queda?"): Seja conciso. Responda diretamente ao ponto com o dado exato e adicione apenas UMA frase de insight ou sugestao acionavel.
- Regra de Ouro Inquebravel: Independentemente do tamanho da resposta ou da area analisada, SEMPRE embase suas afirmacoes nos dados recebidos do backend e NUNCA retorne blocos de codigo SQL ou raw data para o usuario final.

Escopo solicitado para esta resposta: ${scope}.

Regras adicionais:
- Cite numeros concretos (valores absolutos, variacoes, ranking, medias) sempre que possivel.
- Nao retorne JSON, tabela crua, SQL, [AUTO_EXECUTE], [CHART_CONTENT], [CHART_INSIGHT_CONTENT] ou instrucoes tecnicas.
- Se nao houver dados suficientes, diga isso com clareza e sugira a proxima analise mais util.
- Linguagem: profissional, acessivel e orientada a decisao.

Se o escopo for broad, voce DEVE obrigatoriamente encerrar com:
1) Um bloco "Para aprofundar, poderiamos gerar graficos para:" com 3 sugestoes objetivas.
2) Uma pergunta final de continuidade no formato: "Qual dessas analises complementares voce gostaria de explorar?"

As 3 sugestoes devem ser acionaveis e alinhadas ao contexto. Exemplos validos:
- Abertura por categoria/segmento
- Abertura por vendedor/canal/regiao
- Comparativo temporal (ano anterior, trimestre anterior ou tendencia mensal)`;
}

function ensureInsightClosingBlock(
  text: string,
  analysisFocus: string,
): string {
  let output = text.trim();
  if (!output) {
    return output;
  }

  const hasFollowUpHeader =
    /para aprofundar,\s*poderiamos\s+gerar\s+graficos\s+para:/i.test(output) ||
    /para aprofundar,\s*poderiamos analisar:/i.test(output);
  if (!hasFollowUpHeader) {
    output = `${output}\n\n${buildDefaultFollowUpBlock(analysisFocus)}`;
  }

  const hasClosingQuestion =
    /qual dessas analises complementares voce gostaria de explorar\??/i.test(output) ||
    /qual dessas analises voce gostaria de explorar\??/i.test(output);

  if (!hasClosingQuestion) {
    output = `${output}\n\nQual dessas analises complementares voce gostaria de explorar?`;
  }

  return output.trim();
}

function buildDefaultFollowUpBlock(analysisFocus: string): string {
  const normalizedFocus = normalizeIntentText(analysisFocus || "");
  const isSalesContext =
    /\b(venda|vendas|faturamento|receita|ticket|pedido|pedidos)\b/.test(normalizedFocus);

  if (isSalesContext) {
    return `Para aprofundar, poderiamos gerar graficos para:
- Vendas por Categoria de Produto: para entender se a sazonalidade afeta categorias especificas.
- Vendas por Vendedor: para identificar os vendedores de melhor performance e suas estrategias.
- Comparativo Anual: se tivermos dados de anos anteriores, poderemos comparar periodos para identificar tendencias de crescimento de longo prazo.`;
  }

  return `Para aprofundar, poderiamos gerar graficos para:
- Analise por Segmento ou Categoria: para identificar quais grupos concentram resultado.
- Analise por Responsavel, Canal ou Regiao: para encontrar alavancas operacionais.
- Comparativo Temporal (periodo anterior): para confirmar tendencia, sazonalidade e ritmo de crescimento.`;
}

function inferColumns(rows: Record<string, unknown>[]): string[] {
  if (!rows.length) {
    return [];
  }
  return Object.keys(rows[0] || {});
}

function sanitizeInsightNarrative(text: string): string {
  let output = text || "";
  output = output.replace(/\[AUTO_EXECUTE\]/gi, "");
  output = output.replace(/\[CHART_CONTENT\]/gi, "");
  output = output.replace(/\[CHART_INSIGHT_CONTENT\]/gi, "");
  output = output.replace(/\[INSIGHT_CONTENT\]/gi, "");
  output = output.replace(/\[RESULTADO_DA_QUERY\]/gi, "");
  output = output.replace(/\[SQL_DEBUG_ALLOWED\]/gi, "");
  output = output.replace(/```(?:sql|postgres|postgresql)?[\s\S]*?```/gi, "");
  output = output.replace(/\n{3,}/g, "\n\n");
  return output.trim();
}

function sanitizeUserFacingText(text: string, allowTechnicalSql: boolean): string {
  if (allowTechnicalSql) {
    return (text || "").trim();
  }

  let output = text || "";
  output = output.replace(/\[AUTO_EXECUTE\]/gi, "");
  output = output.replace(/\[CHART_CONTENT\]/gi, "");
  output = output.replace(/\[CHART_INSIGHT_CONTENT\]/gi, "");
  output = output.replace(/\[INSIGHT_CONTENT\]/gi, "");
  output = output.replace(/\[RESULTADO_DA_QUERY\]/gi, "");
  output = output.replace(/\[SQL_DEBUG_ALLOWED\]/gi, "");
  output = output.replace(/```(?:sql|postgres|postgresql)?[\s\S]*?```/gi, "");
  output = output.replace(/\n{3,}/g, "\n\n");
  return output.trim();
}

function buildSqlDebugQuery(payload: {
  fields: string;
  tables: string;
  cond: string;
  order?: string;
}): string {
  const base = `SELECT ${payload.fields} FROM ${payload.tables}`;
  const whereClause = payload.cond ? ` WHERE ${payload.cond}` : "";
  const orderClause = payload.order ? ` ORDER BY ${payload.order}` : "";
  return `${base}${whereClause}${orderClause}`.trim();
}

function toBooleanFlag(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  }
  return false;
}

function createTextSseResponse(req: Request, text: string): Response {
  const safeText = text.trim() ? text : "Desculpe, nao consegui gerar uma resposta no momento.";
  return createSseResponse(req, chunkText(safeText, 180));
}

function createChartSseResponse(req: Request, pythonPayload: Record<string, unknown>): Response {
  const chartContent = `[CHART_CONTENT] ${JSON.stringify(pythonPayload)}`;
  return createSseResponse(req, [chartContent]);
}

function createChartInsightSseResponse(req: Request, payload: ChartInsightContentPayload): Response {
  const chartInsightContent = `${CHART_INSIGHT_CONTENT_TAG} ${JSON.stringify(payload)}`;
  return createSseResponse(req, [chartInsightContent]);
}

function createInsightSseResponse(req: Request, payload: InsightContentPayload): Response {
  const insightContent = `${INSIGHT_CONTENT_TAG} ${JSON.stringify(payload)}`;
  return createSseResponse(req, [insightContent]);
}

function extractChartWarnings(pythonPayload: Record<string, unknown>): string[] {
  const rawWarnings = pythonPayload?.warnings;
  if (!Array.isArray(rawWarnings)) {
    return [];
  }

  return rawWarnings
    .map((warning) => (typeof warning === "string" ? warning.trim() : ""))
    .filter((warning) => warning.length > 0);
}

function createSseResponse(req: Request, chunks: string[]): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        if (!chunk) {
          continue;
        }
        const payload = JSON.stringify({
          choices: [{ delta: { content: chunk } }],
        });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      }

      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  const origin = req.headers.get("origin");
  return new Response(stream, {
    headers: {
      ...createCorsHeaders(origin),
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function chunkText(text: string, chunkSize: number): string[] {
  if (!text) {
    return [];
  }

  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize));
  }
  return chunks;
}

function safeJsonParse(text: string): any | null {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function generateChartFromPython(
  rows: Record<string, unknown>[],
  args: any,
): Promise<Record<string, unknown>> {
  const pythonApiUrl = Deno.env.get("PYTHON_API_URL") || DEFAULT_PYTHON_API_URL;
  const internalToken = Deno.env.get("PYTHON_API_TOKEN") || "";

  const payload = {
    data: rows,
    chart_intent: args.chart_type || "auto",
    title: args.chart_title || "Grafico",
  };

  const response = await fetch(`${pythonApiUrl}/generate-chart`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": internalToken,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const rawBody = await response.text();
    throw new SwarmFlowError(`Falha na API Python de graficos (status ${response.status}): ${rawBody}`, emptyUsage());
  }

  return response.json();
}
