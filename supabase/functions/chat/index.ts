import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sseHeaders = {
  ...corsHeaders,
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

const DEFAULT_PYTHON_API_URL = "https://arquem-python-api.onrender.com";
const SQL_DEBUG_ALLOWED_TAG = "[SQL_DEBUG_ALLOWED]";
const MAX_INSIGHT_ROWS = 200;
const INSIGHT_TEMPERATURE = 0.4;

const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "DELETE",
  "UPDATE",
  "DROP",
  "TRUNCATE",
  "ALTER",
  "GRANT",
  "REVOKE",
  "EXEC",
  "EXECUTE",
  "CREATE",
];

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const messages = normalizeRequestMessages(body?.messages);
    const agentId = typeof body?.agentId === "string" ? body.agentId : null;

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ error: "Segredos SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: settings, error: settingsError } = await supabase
      .from("llm_settings")
      .select("*")
      .eq("is_active", true)
      .single();

    if (settingsError || !settings) {
      return new Response(
        JSON.stringify({ error: "Configure suas credenciais de LLM na aba Admin primeiro." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const provider = normalizeProvider(settings.provider);
    if (!provider) {
      return new Response(
        JSON.stringify({ error: `Provider nao suportado: ${settings.provider}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const activeSettings: ActiveSettings = {
      provider,
      apiKey: settings.api_key,
      model: settings.model,
    };

    let agentContext: { agent: any; tables: any[] } | null = null;
    if (agentId) {
      const { data: agent } = await supabase.from("agents").select("*").eq("id", agentId).single();

      if (agent) {
        const { data: agentTables } = await supabase
          .from("agent_tables")
          .select("*")
          .eq("agent_id", agentId);

        agentContext = { agent, tables: agentTables || [] };
      }
    }

    const externalUrl = Deno.env.get("EXTERNAL_SUPABASE_URL");
    const externalKey = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_KEY");

    if (!externalUrl || !externalKey) {
      return new Response(
        JSON.stringify({
          error:
            "Banco externo nao configurado. Defina EXTERNAL_SUPABASE_URL e EXTERNAL_SUPABASE_SERVICE_KEY.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const externalSupabase = createClient(externalUrl, externalKey);
    const lastUserMessage = getLastUserMessage(messages);
    const userIntent = detectUserIntent(lastUserMessage);

    let metadataContext = "";
    try {
      const { data: externalMetadata } = await externalSupabase.rpc("get_database_metadata");
      let filteredData = (externalMetadata || []).filter((row: any) => row.schema_name === "public");

      if (agentContext && agentContext.tables.length > 0) {
        const allowedTables = new Set(
          agentContext.tables.map((table: any) => {
            const schemaName =
              typeof table.schema_name === "string" && table.schema_name.startsWith("external.")
                ? table.schema_name.replace(/^external\./, "")
                : table.schema_name;
            return `${schemaName}.${table.table_name}`;
          }),
        );

        filteredData = filteredData.filter((row: any) =>
          allowedTables.has(`${row.schema_name}.${row.table_name}`)
        );
      }

      if (filteredData.length > 0) {
        metadataContext =
          `\n\nEstrutura do banco de dados Supabase externo (schema public):\n${formatMetadata(filteredData)}`;
      }
    } catch (metadataError) {
      console.log("Could not fetch external metadata:", metadataError);
    }

    const targetDescription = "BANCO DE DADOS EXTERNO no Supabase (apenas schema public)";
    const behaviorPrompt = buildBehaviorPrompt(agentContext, targetDescription);
    const technicalInstructions = buildTechnicalInstructions(userIntent);
    const systemPrompt = `${behaviorPrompt}\n${technicalInstructions}\n${metadataContext}`;

    const llmOptions: LLMCallOptions = {
      withTools: userIntent !== "explicit_sql",
      temperature: userIntent === "insight" ? INSIGHT_TEMPERATURE : undefined,
    };

    let llmResult = await callProvider(activeSettings, systemPrompt, messages, llmOptions);

    if (llmResult.type === "text" && (userIntent === "chart" || userIntent === "insight")) {
      const forcedToolName: ToolName = userIntent === "chart" ? "generate_chart" : "generate_insight";
      const forcedResult = await tryForceToolCall(activeSettings, systemPrompt, messages, forcedToolName);
      if (forcedResult) {
        llmResult = forcedResult;
      }
    }

    if (llmResult.type === "tool_call_chart") {
      const queryData = await executeChartQuery(externalSupabase, llmResult.args.sql_query);
      const pythonResponse = await generateChartFromPython(queryData, llmResult.args);
      return createChartSseResponse(pythonResponse);
    }

    if (llmResult.type === "tool_call_insight") {
      const insightText = await runInsightFlow(
        activeSettings,
        externalSupabase,
        lastUserMessage,
        llmResult.args,
      );
      return createTextSseResponse(insightText);
    }

    let finalText = sanitizeUserFacingText(llmResult.text, userIntent === "explicit_sql");
    if (userIntent === "explicit_sql" && containsSqlExecutionContent(finalText)) {
      finalText = `${SQL_DEBUG_ALLOWED_TAG}\n${finalText}`;
    }

    return createTextSseResponse(finalText);
  } catch (error) {
    console.error("Chat error:", error);
    const errorMessage = error instanceof Error ? error.message : "Erro interno do servidor";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function buildBehaviorPrompt(
  agentContext: { agent: any; tables: any[] } | null,
  targetDescription: string,
): string {
  if (agentContext) {
    const tablesList = agentContext.tables
      .map((table: any) => {
        const schemaName =
          typeof table.schema_name === "string" && table.schema_name.startsWith("external.")
            ? table.schema_name.replace(/^external\./, "")
            : table.schema_name;
        return `${schemaName}.${table.table_name}`;
      })
      .filter((table: string) => table.startsWith("public."))
      .join(", ");

    if (agentContext.agent.system_prompt) {
      return agentContext.agent.system_prompt;
    }

    return `Voce e ${agentContext.agent.name}, um assistente de inteligencia de negocios especializado nas areas: ${tablesList}.

Seu papel e atuar como um analista senior dedicado ao negocio do usuario.
Voce deve:
- Responder com profundidade e contexto de negocio, nao apenas dados brutos
- Ao apresentar resultados, sempre interpretar o que os numeros significam para o negocio (tendencias, alertas, oportunidades)
- Sugerir proativamente analises complementares relevantes
- Usar linguagem profissional e acessivel
- Quando o usuario perguntar algo generico, direcionar para as tabelas que voce domina e oferecer opcoes de analise

Voce so tem acesso as seguintes tabelas: ${tablesList}
Gere queries APENAS sobre essas tabelas.`;
  }

  return `Voce e um assistente especializado em analise de banco de dados PostgreSQL.

Suas capacidades:
- Criar queries SELECT de qualquer complexidade
- Usar CTEs (WITH ... AS), subqueries, window functions (ROW_NUMBER, RANK, NTILE, etc.)
- Funcoes de agregacao complexas (SUM, COUNT, AVG, GROUP BY, HAVING)
- JOINs entre multiplas tabelas
- Analises avancadas como Curva ABC, Pareto, rankings e medias moveis
- Sugerir otimizacoes e melhores praticas

CONTEXTO: O usuario esta usando o ${targetDescription}.
RESTRICAO: voce so pode usar tabelas do schema public.`;
}

function buildTechnicalInstructions(userIntent: UserIntent): string {
  const technicalSqlAllowed = userIntent === "explicit_sql";

  if (technicalSqlAllowed) {
    return `
LIBERDADE PARA QUERIES DE LEITURA:
- Use qualquer recurso SQL necessario para analise
- Queries devem ser somente leitura
- Use apenas schema public
- NUNCA coloque ponto e virgula (;) no fim da query

MODO SQL EXPLICITO:
- O usuario pediu SQL/query explicitamente
- Retorne [AUTO_EXECUTE] seguido de bloco SQL quando precisar executar consulta no frontend
- Mantenha foco tecnico
- Nao usar generate_chart nem generate_insight neste modo`;
  }

  return `
LIBERDADE PARA QUERIES DE LEITURA:
- Use qualquer recurso SQL necessario para analise
- Queries devem ser somente leitura
- Use apenas schema public
- NUNCA coloque ponto e virgula (;) no fim da query

USO OBRIGATORIO DA TOOL generate_chart:
- Se o usuario pedir grafico, visualizacao, plot, dashboard ou tendencia visual, use a tool generate_chart
- Preencha sql_query, chart_type e chart_title
- Nao retorne [AUTO_EXECUTE] nem bloco SQL quando optar por generate_chart

USO OBRIGATORIO DA TOOL generate_insight:
- Se o usuario pedir analise textual, tendencia, diagnostico ou resumo de desempenho sem pedir grafico, use a tool generate_insight
- Preencha sql_query, analysis_scope e analysis_focus
- Nao retorne [AUTO_EXECUTE], SQL bruto ou raw data para usuario final

REGRA DE OURO:
- Nunca exponha SQL ao usuario final em respostas comuns
- Nunca retorne [AUTO_EXECUTE] fora do modo SQL explicito`;
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

function detectUserIntent(lastUserMessage: string): UserIntent {
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

  const asksChart =
    /\b(grafico|plot|visualizacao|dashboard|pizza|barras|linha|scatter|dispersao)\b/.test(normalized) ||
    /\btendencia visual\b/.test(normalized);
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

function normalizeProvider(provider: unknown): ProviderName | null {
  if (provider === "openai" || provider === "gemini") {
    return provider;
  }
  return null;
}

function formatMetadata(metadata: any[]): string {
  const grouped: Record<string, Record<string, string[]>> = {};

  for (const row of metadata) {
    if (!grouped[row.schema_name]) {
      grouped[row.schema_name] = {};
    }
    if (!grouped[row.schema_name][row.table_name]) {
      grouped[row.schema_name][row.table_name] = [];
    }
    grouped[row.schema_name][row.table_name].push(
      `${row.column_name} (${row.data_type}${row.is_nullable ? ", nullable" : ""})`,
    );
  }

  let result = "";
  for (const [schema, tables] of Object.entries(grouped)) {
    result += `\nSchema: ${schema}\n`;
    for (const [table, columns] of Object.entries(tables)) {
      result += `  Tabela: ${table}\n`;
      result += `    Colunas: ${columns.join(", ")}\n`;
    }
  }
  return result;
}

async function callProvider(
  settings: ActiveSettings,
  systemPrompt: string,
  messages: ChatMessage[],
  options: LLMCallOptions = {},
): Promise<LLMResult> {
  if (settings.provider === "openai") {
    return await callOpenAI(settings.apiKey, settings.model, systemPrompt, messages, options);
  }
  return await callGemini(settings.apiKey, settings.model, systemPrompt, messages, options);
}

async function tryForceToolCall(
  settings: ActiveSettings,
  systemPrompt: string,
  messages: ChatMessage[],
  forceToolName: ToolName,
): Promise<LLMResult | null> {
  try {
    const forcedResult = await callProvider(settings, systemPrompt, messages, {
      withTools: true,
      forceToolName,
      temperature: INSIGHT_TEMPERATURE,
    });

    if (forcedResult.type === "tool_call_chart" || forcedResult.type === "tool_call_insight") {
      return forcedResult;
    }
  } catch (error) {
    console.warn(`Forced tool call failed for ${forceToolName}:`, error);
  }

  return null;
}

async function callOpenAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  options: LLMCallOptions = {},
): Promise<LLMResult> {
  return await callOpenAIInternal(apiKey, model, systemPrompt, messages, options);
}

async function callOpenAIInternal(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  options: LLMCallOptions,
): Promise<LLMResult> {
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
    throw new Error(`Erro OpenAI (${response.status}): ${extractProviderError(rawBody)}`);
  }

  const payload = safeJsonParse(rawBody) || {};
  const message = payload?.choices?.[0]?.message;

  if (withTools) {
    const toolResult = extractOpenAIToolResult(message?.tool_calls);
    if (toolResult) {
      return toolResult;
    }
  }

  const text = extractOpenAIText(message?.content);
  return { type: "text", text: text || "Desculpe, nao consegui gerar uma resposta no momento." };
}

async function callGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  options: LLMCallOptions = {},
): Promise<LLMResult> {
  return await callGeminiInternal(apiKey, model, systemPrompt, messages, options);
}

async function callGeminiInternal(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  options: LLMCallOptions,
): Promise<LLMResult> {
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

  if (withTools) {
    const toolResult = extractGeminiToolResult(parts);
    if (toolResult) {
      return toolResult;
    }
  }

  const text = extractGeminiText(parts);
  return { type: "text", text: text || "Desculpe, nao consegui gerar uma resposta no momento." };
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

function isReadOnlyQuery(query: string): boolean {
  const upperQuery = query.toUpperCase().trim();

  for (const keyword of FORBIDDEN_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(upperQuery)) {
      return false;
    }
  }

  return /^\s*(SELECT|WITH)\b/i.test(query);
}

function referencesNonPublicSchema(query: string): boolean {
  const normalized = query.toLowerCase();
  const fromJoinPattern = /\b(?:from|join)\s+([a-z_][a-z0-9_]*)(?:\s*\.\s*([a-z_][a-z0-9_]*))?/gi;

  for (const match of normalized.matchAll(fromJoinPattern)) {
    const schema = match[2] ? match[1] : null;
    if (schema && schema !== "public") {
      return true;
    }
  }

  return false;
}

async function executeReadOnlyQuery(
  externalSupabase: any,
  sqlQuery: string,
  purpose: "grafico" | "insight",
): Promise<Record<string, unknown>[]> {
  const sanitizedQuery = sanitizeSqlQuery(sqlQuery);
  if (!sanitizedQuery) {
    throw new Error(`A tool para ${purpose} retornou sql_query vazia.`);
  }

  if (!isReadOnlyQuery(sanitizedQuery)) {
    throw new Error(`A query de ${purpose} deve ser somente leitura (SELECT/CTE).`);
  }

  if (referencesNonPublicSchema(sanitizedQuery)) {
    throw new Error(`Apenas tabelas do schema public sao permitidas para ${purpose}.`);
  }

  const { data, error } = await externalSupabase.rpc("execute_safe_query", {
    query_text: sanitizedQuery,
  });

  if (error) {
    throw new Error(`Erro na execucao da query para ${purpose}: ${error.message}`);
  }

  return Array.isArray(data) ? data : [];
}

async function executeChartQuery(externalSupabase: any, sqlQuery: string): Promise<Record<string, unknown>[]> {
  return await executeReadOnlyQuery(externalSupabase, sqlQuery, "grafico");
}

async function executeInsightQuery(externalSupabase: any, sqlQuery: string): Promise<Record<string, unknown>[]> {
  return await executeReadOnlyQuery(externalSupabase, sqlQuery, "insight");
}

async function generateChartFromPython(
  data: Record<string, unknown>[],
  chartArgs: ChartToolArgs,
): Promise<Record<string, unknown>> {
  const configuredUrl = Deno.env.get("PYTHON_API_URL")?.trim();
  const pythonApiUrl = configuredUrl || DEFAULT_PYTHON_API_URL;
  const pythonApiToken = Deno.env.get("PYTHON_INTERNAL_API_TOKEN")?.trim();
  const endpoint = `${pythonApiUrl.replace(/\/+$/, "")}/generate-chart`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (pythonApiToken) {
    headers["X-Internal-Token"] = pythonApiToken;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      data,
      chart_intent: chartArgs.chart_type,
      title: chartArgs.chart_title,
    }),
  });

  const rawBody = await response.text();
  const parsedBody = safeJsonParse(rawBody);

  if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    throw new Error(`Resposta invalida da API Python (${response.status}).`);
  }

  if (!response.ok) {
    console.warn(`Python API returned status ${response.status}:`, parsedBody);
  }

  return parsedBody as Record<string, unknown>;
}

async function runInsightFlow(
  settings: ActiveSettings,
  externalSupabase: any,
  userQuestion: string,
  insightArgs: InsightToolArgs,
): Promise<string> {
  const queryData = await executeInsightQuery(externalSupabase, insightArgs.sql_query);
  return await synthesizeInsightText(settings, userQuestion, insightArgs, queryData);
}

async function synthesizeInsightText(
  settings: ActiveSettings,
  userQuestion: string,
  insightArgs: InsightToolArgs,
  queryData: Record<string, unknown>[],
): Promise<string> {
  const limitedRows = queryData.slice(0, MAX_INSIGHT_ROWS);
  const truncated = queryData.length > MAX_INSIGHT_ROWS;
  if (truncated) {
    console.log(`Insight rows truncated from ${queryData.length} to ${MAX_INSIGHT_ROWS}.`);
  }

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

  const synthesisResult = await callProvider(
    settings,
    synthesisSystemPrompt,
    synthesisMessages,
    {
      withTools: false,
      temperature: INSIGHT_TEMPERATURE,
    },
  );

  if (synthesisResult.type !== "text") {
    throw new Error("A sintese de insight retornou formato inesperado.");
  }

  const cleaned = sanitizeInsightNarrative(synthesisResult.text);
  if (cleaned) {
    return ensureInsightClosingBlock(
      cleaned,
      insightArgs.analysis_scope,
      insightArgs.analysis_focus,
      userQuestion,
    );
  }

  if (queryData.length === 0) {
    return "Nao encontrei registros para essa analise no periodo informado. Posso revisar os filtros e tentar outra abordagem.";
  }

  return "Nao foi possivel concluir a sintese analitica no momento, mas os dados foram processados com sucesso.";
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
- Nao retorne JSON, tabela crua, SQL, [AUTO_EXECUTE], [CHART_CONTENT] ou instrucoes tecnicas.
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
  scope: InsightScope,
  analysisFocus: string,
  userQuestion: string,
): string {
  if (!shouldAppendFollowUpSuggestions(scope, userQuestion)) {
    return text.trim();
  }

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

function shouldAppendFollowUpSuggestions(scope: InsightScope, userQuestion: string): boolean {
  if (scope === "broad") {
    return true;
  }

  const normalizedQuestion = normalizeIntentText(userQuestion || "");
  if (!normalizedQuestion) {
    return false;
  }

  const asksDeepAnalysis =
    /\b(analise|analisar|insight|resumo|diagnostico|desempenho|tendencia|avaliar|interpretar)\b/.test(
      normalizedQuestion,
    );

  const looksStrictlyDirect =
    /\b(qual|quanto|quantos|quando|onde|quem)\b/.test(normalizedQuestion) && !asksDeepAnalysis;

  return asksDeepAnalysis && !looksStrictlyDirect;
}

function buildDefaultFollowUpBlock(analysisFocus: string): string {
  const normalizedFocus = normalizeIntentText(analysisFocus || "");
  const isSalesContext =
    /\b(venda|vendas|faturamento|receita|ticket|pedido|pedidos)\b/.test(normalizedFocus);

  if (isSalesContext) {
    return `Para aprofundar, poderiamos gerar graficos para:
- Vendas por Categoria de Produto: para identificar quais categorias puxam os picos e as quedas.
- Vendas por Vendedor ou Canal: para entender onde estao os principais ganhos de performance.
- Comparativo Anual ou Trimestral: para separar sazonalidade de crescimento estrutural.`;
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
  output = output.replace(/\[RESULTADO_DA_QUERY\]/gi, "");
  output = output.replace(/\[SQL_DEBUG_ALLOWED\]/gi, "");
  output = output.replace(/```(?:sql|postgres|postgresql)?[\s\S]*?```/gi, "");
  output = output.replace(/\n{3,}/g, "\n\n");
  return output.trim();
}

function containsSqlExecutionContent(text: string): boolean {
  const output = text || "";
  if (/\[AUTO_EXECUTE\]/i.test(output)) {
    return true;
  }
  if (/```(?:sql|postgres|postgresql)?[\s\S]*?```/i.test(output)) {
    return true;
  }
  if (/^\s*(SELECT|WITH)\b/i.test(output.trimStart())) {
    return true;
  }
  return false;
}

function createTextSseResponse(text: string): Response {
  const safeText = text.trim() ? text : "Desculpe, nao consegui gerar uma resposta no momento.";
  return createSseResponse(chunkText(safeText, 180));
}

function createChartSseResponse(pythonPayload: Record<string, unknown>): Response {
  const chartContent = `[CHART_CONTENT] ${JSON.stringify(pythonPayload)}`;
  return createSseResponse([chartContent]);
}

function createSseResponse(chunks: string[]): Response {
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

  return new Response(stream, { headers: sseHeaders });
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
