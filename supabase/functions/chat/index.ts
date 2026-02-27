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
type ChartType = (typeof CHART_TYPES)[number];

type ChartToolArgs = {
  sql_query: string;
  chart_type: ChartType;
  chart_title: string;
};

type ChatMessage = {
  role: string;
  content: string;
};

type LLMResult =
  | { type: "text"; text: string }
  | { type: "tool_call"; args: ChartToolArgs };

const OPENAI_CHART_TOOLS = [
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
];

const GEMINI_CHART_TOOLS = [
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
    const technicalInstructions = buildTechnicalInstructions();
    const systemPrompt = `${behaviorPrompt}\n${technicalInstructions}\n${metadataContext}`;

    const llmResult =
      settings.provider === "openai"
        ? await callOpenAI(settings.api_key, settings.model, systemPrompt, messages)
        : await callGemini(settings.api_key, settings.model, systemPrompt, messages);

    if (llmResult.type === "tool_call") {
      const queryData = await executeChartQuery(externalSupabase, llmResult.args.sql_query);
      const pythonResponse = await generateChartFromPython(queryData, llmResult.args);
      return createChartSseResponse(pythonResponse);
    }

    return createTextSseResponse(llmResult.text);
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

function buildTechnicalInstructions(): string {
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

PARA CONSULTAS TEXTUAIS (SEM GRAFICO):
- Continue respondendo normalmente
- Quando precisar executar SQL para o frontend, use a tag [AUTO_EXECUTE] antes do bloco SQL
- Apos os resultados, explique brevemente o significado de negocio`;
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

async function callOpenAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
): Promise<LLMResult> {
  return await callOpenAIInternal(apiKey, model, systemPrompt, messages, true);
}

async function callOpenAIInternal(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  withTools: boolean,
): Promise<LLMResult> {
  const requestBody: Record<string, unknown> = {
    model,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    stream: false,
  };

  if (withTools) {
    requestBody.tools = OPENAI_CHART_TOOLS;
    requestBody.tool_choice = "auto";
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
    if (withTools && shouldRetryWithoutTools(response.status, rawBody)) {
      console.warn("OpenAI rejected tools payload, retrying without tools.");
      return await callOpenAIInternal(apiKey, model, systemPrompt, messages, false);
    }
    throw new Error(`Erro OpenAI (${response.status}): ${extractProviderError(rawBody)}`);
  }

  const payload = safeJsonParse(rawBody) || {};
  const message = payload?.choices?.[0]?.message;

  if (withTools) {
    const toolArgs = extractOpenAIToolArgs(message?.tool_calls);
    if (toolArgs) {
      return { type: "tool_call", args: toolArgs };
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
): Promise<LLMResult> {
  return await callGeminiInternal(apiKey, model, systemPrompt, messages, true);
}

async function callGeminiInternal(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  withTools: boolean,
): Promise<LLMResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contents = messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));

  const requestBody: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
  };

  if (withTools) {
    requestBody.tools = GEMINI_CHART_TOOLS;
    requestBody.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  const rawBody = await response.text();
  if (!response.ok) {
    if (withTools && shouldRetryWithoutTools(response.status, rawBody)) {
      console.warn("Gemini rejected tools payload, retrying without tools.");
      return await callGeminiInternal(apiKey, model, systemPrompt, messages, false);
    }
    throw new Error(`Erro Gemini (${response.status}): ${extractProviderError(rawBody)}`);
  }

  const payload = safeJsonParse(rawBody) || {};
  const parts = payload?.candidates?.[0]?.content?.parts || [];

  if (withTools) {
    const toolArgs = extractGeminiToolArgs(parts);
    if (toolArgs) {
      return { type: "tool_call", args: toolArgs };
    }
  }

  const text = extractGeminiText(parts);
  return { type: "text", text: text || "Desculpe, nao consegui gerar uma resposta no momento." };
}

function extractOpenAIToolArgs(toolCalls: any[]): ChartToolArgs | null {
  if (!Array.isArray(toolCalls)) {
    return null;
  }

  for (const toolCall of toolCalls) {
    if (toolCall?.function?.name !== "generate_chart") {
      continue;
    }

    const rawArgs = toolCall?.function?.arguments;
    const parsedArgs = typeof rawArgs === "string" ? safeJsonParse(rawArgs) : rawArgs;
    const normalized = normalizeChartToolArgs(parsedArgs);

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function extractGeminiToolArgs(parts: any[]): ChartToolArgs | null {
  if (!Array.isArray(parts)) {
    return null;
  }

  for (const part of parts) {
    const functionCall = part?.functionCall || part?.function_call;
    if (!functionCall || functionCall.name !== "generate_chart") {
      continue;
    }

    const rawArgs = functionCall.args ?? functionCall.arguments;
    const parsedArgs = typeof rawArgs === "string" ? safeJsonParse(rawArgs) : rawArgs;
    const normalized = normalizeChartToolArgs(parsedArgs);

    if (normalized) {
      return normalized;
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

async function executeChartQuery(externalSupabase: any, sqlQuery: string): Promise<Record<string, unknown>[]> {
  const sanitizedQuery = sanitizeSqlQuery(sqlQuery);
  if (!sanitizedQuery) {
    throw new Error("A tool generate_chart retornou sql_query vazia.");
  }

  if (!isReadOnlyQuery(sanitizedQuery)) {
    throw new Error("A query do grafico deve ser somente leitura (SELECT/CTE).");
  }

  if (referencesNonPublicSchema(sanitizedQuery)) {
    throw new Error("Apenas tabelas do schema public sao permitidas para gerar graficos.");
  }

  const { data, error } = await externalSupabase.rpc("execute_safe_query", {
    query_text: sanitizedQuery,
  });

  if (error) {
    throw new Error(`Erro na execucao da query para grafico: ${error.message}`);
  }

  return Array.isArray(data) ? data : [];
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
