import type { TokenUsage } from "./supervisor.ts";

export interface QueryGeneratorInput {
  userMessage: string;
  activeSchemas: string;
}

export interface QueryGeneratorOutput {
  error?: string;
  fields?: string;
  tables?: string;
  cond?: string;
  order?: string;
  rowspPage?: number;
  chart_type?: "bar" | "line" | "pie" | "scatter";
  chart_title?: string;
  failureCode?:
    | "missing_api_key"
    | "provider_http_error"
    | "provider_invalid_json"
    | "empty_result"
    | "result_invalid_json"
    | "incomplete_payload"
    | "network_error"
    | "unexpected_error";
  failureDetail?: string;
  failureHttpStatus?: number;
  retriable?: boolean;
  usage: TokenUsage;
  shouldFallback: boolean;
}

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function toSafeTokenCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function extractGeminiUsage(rawUsage: any): TokenUsage {
  const input = toSafeTokenCount(rawUsage?.promptTokenCount ?? rawUsage?.inputTokenCount);
  const output = toSafeTokenCount(rawUsage?.candidatesTokenCount ?? rawUsage?.outputTokenCount);
  const total = toSafeTokenCount(rawUsage?.totalTokenCount) || input + output;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}

function parseResponseText(rawData: any): string {
  const parts = rawData?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";

  const textParts = parts
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .filter((part: string) => part.trim().length > 0);

  return textParts.join("\n").trim();
}

function safeJsonParse(text: string): any | null {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function compactText(value: string, maxLength = 320): string {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function extractProviderErrorMessage(rawData: any, rawText: string): string {
  if (typeof rawData?.error?.message === "string") {
    return compactText(rawData.error.message);
  }
  if (typeof rawData?.message === "string") {
    return compactText(rawData.message);
  }
  return compactText(rawText || "Erro desconhecido do provedor.");
}

function isRetriableHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

class QueryGeneratorFailure extends Error {
  code:
    | "provider_http_error"
    | "provider_invalid_json"
    | "empty_result"
    | "result_invalid_json"
    | "incomplete_payload"
    | "network_error"
    | "unexpected_error";
  status?: number;
  detail?: string;
  retriable: boolean;
  usage: TokenUsage;

  constructor(params: {
    message: string;
    code:
      | "provider_http_error"
      | "provider_invalid_json"
      | "empty_result"
      | "result_invalid_json"
      | "incomplete_payload"
      | "network_error"
      | "unexpected_error";
    status?: number;
    detail?: string;
    retriable: boolean;
    usage?: TokenUsage;
  }) {
    super(params.message);
    this.name = "QueryGeneratorFailure";
    this.code = params.code;
    this.status = params.status;
    this.detail = params.detail;
    this.retriable = params.retriable;
    this.usage = params.usage || emptyUsage();
  }
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toRowspPage(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;

  const rounded = Math.round(parsed);
  if (rounded < 1) return 1;
  if (rounded > 10000) return 10000;
  return rounded;
}

function normalizeChartType(value: unknown): "bar" | "line" | "pie" | "scatter" | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "bar" || normalized === "line" || normalized === "pie" || normalized === "scatter") {
    return normalized;
  }
  return undefined;
}

function buildTemporalContext(): string {
  const timezone = Deno.env.get("APP_TIMEZONE")?.trim() || "America/Sao_Paulo";
  const now = new Date();

  const date = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);

  return `${date} ${time} (${timezone})`;
}

function buildSystemPrompt(activeSchemas: string): string {
  return `Voce e um Arquiteto de Dados SQL Server especialista.
Sua missao e traduzir a pergunta do usuario para um payload JSON compativel com nossa API Delphi.
A API executa internamente: SELECT {fields} FROM {tables} WHERE {cond} ORDER BY {order}

Data e hora atual do servidor: ${buildTemporalContext()}.
Use esta referencia para "hoje", "ontem", "este mes", "mes passado" e janelas de tempo.

DICIONARIO DE DADOS AUTORIZADO:
${activeSchemas}

REGRAS ESTRITAS:
1. Use APENAS tabelas e colunas do dicionario recebido. Nao invente campos.
2. Dialeto SQL Server obrigatorio.
3. Datas em filtros devem usar CONVERT(DATE, campo) quando aplicavel.
4. Se houver agregacao (SUM/COUNT/etc) com outros campos, inclua GROUP BY no FINAL da string cond.
5. Nao use ponto e virgula no final.
6. Defina rowspPage com autonomia: 15/50 para listas curtas, ate 10000 para cargas densas de grafico.
7. Se a pergunta estiver fora do escopo do dicionario, retorne APENAS {"error":"..."}.
8. Se a pergunta indicar grafico, pode incluir chart_type (bar|line|pie|scatter) e chart_title.
9. ORDER BY e OBRIGATORIO em TODA query. Nunca use ORDER BY por posicao (ex: ORDER BY 1,2,3).
10. ORDER BY deve usar nomes explicitos de colunas ou aliases do SELECT.
11. Se o usuario nao indicar ordenacao, escolha uma coluna estavel (data/id) para manter consistencia.
12. Para perguntas do dominio comercial (vendas, faturamento, pedidos, clientes, vendedores, descontos, devolucoes, frete, prospeccao), priorize ATENDIMENTO e use CLIE_ID_VENDEDOR para relacionar com CLIENTE quando precisar do vendedor.
13. Para vendas sem metrica explicitamente definida, prefira ATEN_VLTOTALLIQUIDO como valor padrao, pois ja deduz devolucoes.
14. Use ATEN_VLLIQUIDO apenas quando o usuario pedir valor liquido sem deduzir devolucao. Use ATEN_VLBAIXADOLIQUIDO apenas para valores efetivamente recebidos, baixados, caixa ou financeiro.
15. Para tabelas usadas na query que tiverem coluna sufixo _ID_DEL, aplique filtro de ativo com IS NULL.
16. Em ATENDIMENTO, exclua orcamentos por padrao com ATEN_STTIPO = 'V', exceto quando o usuario pedir orcamento explicitamente.
17. Para perguntas de faturamento por periodo (ex: "quanto foi vendido em outubro de 2025"), priorize consulta agregada com SUM no periodo solicitado e retorne apenas o necessario para responder o valor.
18. Quando a pergunta for de total vendido em um periodo unico, evite granularidade por cliente/produto; retorne uma unica linha agregada com alias semantico (ex: total_vendido).
19. Para analises semanais de vendas, agrupe por semana usando ATEN_DTEMISSAO como base temporal.

Retorne APENAS um objeto JSON.`;
}

function containsPositionalOrder(order: string): boolean {
  const items = order
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (items.length === 0) return false;
  return items.some((item) => /^\d+(\s+(asc|desc))?$/i.test(item));
}

const SQL_STOPWORDS = new Set([
  "select",
  "from",
  "where",
  "group",
  "by",
  "order",
  "having",
  "limit",
  "offset",
  "top",
  "distinct",
  "as",
  "and",
  "or",
  "not",
  "null",
  "is",
  "in",
  "like",
  "between",
  "exists",
  "case",
  "when",
  "then",
  "else",
  "end",
  "sum",
  "count",
  "avg",
  "min",
  "max",
  "month",
  "year",
  "day",
  "date",
  "convert",
  "cast",
  "coalesce",
  "upper",
  "lower",
  "substring",
  "left",
  "right",
  "inner",
  "outer",
  "join",
  "on",
]);

function extractAliases(fields: string): string[] {
  const aliases: string[] = [];
  const regex = /\bas\s+([a-z_][a-z0-9_]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(fields)) !== null) {
    aliases.push(match[1]);
  }
  return aliases;
}

function extractIdentifiers(input: string): string[] {
  const matches = input.match(/\b[a-z_][a-z0-9_]*\b/gi) || [];
  return matches;
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

function filterIdentifierCandidates(values: string[], blocked: Set<string>): string[] {
  const output: string[] = [];
  const seen = new Set<string>();

  for (const raw of values) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const normalized = normalizeIdentifier(trimmed);

    if (blocked.has(normalized)) continue;
    if (normalized.length <= 1) continue;
    if (/^\d+$/.test(normalized)) continue;
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    output.push(trimmed);
  }

  return output;
}

function pickFirstMatching(
  candidates: string[],
  patterns: RegExp[],
): string | undefined {
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    if (patterns.some((pattern) => pattern.test(normalized))) {
      return candidate;
    }
  }
  return undefined;
}

function buildOrderFallback(fields: string, cond: string, tables: string): string {
  const tableIds = extractIdentifiers(tables);
  const blocked = new Set<string>([
    ...SQL_STOPWORDS,
    ...tableIds.map((value) => normalizeIdentifier(value)),
  ]);

  const aliasCandidates = filterIdentifierCandidates(extractAliases(fields), blocked);
  const fieldIds = filterIdentifierCandidates(extractIdentifiers(fields), blocked);
  const condIds = filterIdentifierCandidates(extractIdentifiers(cond), blocked);

  const candidates = [
    ...aliasCandidates,
    ...fieldIds,
    ...condIds,
  ];

  const datePatterns = [
    /(^dt|_dt|dt_)/,
    /data/,
    /date/,
    /created_at/,
    /updated_at/,
    /emissao/,
    /cadastro/,
    /operac/,
    /venda/,
  ];

  const idPatterns = [/^id$/, /_id$/, /id_/];

  const dateCandidate = pickFirstMatching(candidates, datePatterns);
  if (dateCandidate) return dateCandidate;

  const idCandidate = pickFirstMatching(candidates, idPatterns);
  if (idCandidate) return idCandidate;

  if (aliasCandidates.length > 0) {
    return aliasCandidates[0];
  }

  if (candidates.length > 0) {
    return candidates[0];
  }

  return "id";
}

function sanitizeForLog(value: string, maxLength: number): string {
  const withoutLiterals = value.replace(/'[^']*'/g, "'***'");
  const normalized = withoutLiterals.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

type TableReference = {
  table: string;
  alias: string;
};

const TABLE_ALIAS_BLOCKLIST = new Set([
  "LEFT",
  "RIGHT",
  "INNER",
  "FULL",
  "CROSS",
  "JOIN",
  "ON",
  "WHERE",
  "GROUP",
  "ORDER",
  "HAVING",
]);

function sanitizeAlias(aliasCandidate: string | undefined, fallbackTable: string): string {
  if (!aliasCandidate) return fallbackTable;
  const normalized = aliasCandidate.toUpperCase();
  if (TABLE_ALIAS_BLOCKLIST.has(normalized)) {
    return fallbackTable;
  }
  return aliasCandidate;
}

function normalizeIntentText(text: string): string {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function userAskedForBudget(userMessage: string): boolean {
  const normalized = normalizeIntentText(userMessage);
  if (!normalized) return false;
  return /\b(orcamento|orcamentos|cotacao|cotacoes)\b/.test(normalized);
}

function parseSchemaIdDelColumns(activeSchemas: string): Map<string, string[]> {
  const tableToIdDelColumns = new Map<string, string[]>();
  const tableRegex = /Tabela:\s*([A-Z0-9_]+)([\s\S]*?)(?=\nTabela:\s*[A-Z0-9_]+|\nRegra Global:|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = tableRegex.exec(activeSchemas)) !== null) {
    const tableName = (match[1] || "").toUpperCase();
    const block = match[2] || "";
    const columns: string[] = [];

    const columnRegex = /-\s*([A-Z0-9_]+)\s*\(/gi;
    let colMatch: RegExpExecArray | null;
    while ((colMatch = columnRegex.exec(block)) !== null) {
      const col = (colMatch[1] || "").toUpperCase();
      if (/_ID_DEL$/.test(col)) {
        columns.push(col);
      }
    }

    if (columns.length > 0) {
      tableToIdDelColumns.set(tableName, columns);
    }
  }

  return tableToIdDelColumns;
}

function parseTableReferences(tables: string): TableReference[] {
  const refs: TableReference[] = [];
  const seen = new Set<string>();
  const source = (tables || "").trim();
  if (!source) return refs;

  const firstMatch = source.match(/^\s*([A-Z0-9_.]+)(?:\s+(?:AS\s+)?([A-Z0-9_]+))?/i);
  if (firstMatch) {
    const table = firstMatch[1].split(".").pop() || firstMatch[1];
    const alias = sanitizeAlias(firstMatch[2], table);
    const key = `${table.toUpperCase()}::${alias.toUpperCase()}`;
    if (!seen.has(key)) {
      refs.push({ table: table.toUpperCase(), alias });
      seen.add(key);
    }
  }

  const joinRegex = /\b(?:LEFT|RIGHT|INNER|FULL|CROSS)?\s*JOIN\s+([A-Z0-9_.]+)(?:\s+(?:AS\s+)?([A-Z0-9_]+))?/gi;
  let joinMatch: RegExpExecArray | null;
  while ((joinMatch = joinRegex.exec(source)) !== null) {
    const table = (joinMatch[1] || "").split(".").pop() || "";
    if (!table) continue;
    const alias = sanitizeAlias(joinMatch[2], table);
    const key = `${table.toUpperCase()}::${alias.toUpperCase()}`;
    if (!seen.has(key)) {
      refs.push({ table: table.toUpperCase(), alias });
      seen.add(key);
    }
  }

  return refs;
}

function hasCondition(cond: string, pattern: RegExp): boolean {
  return pattern.test(cond);
}

function injectIntoCond(cond: string, clause: string): string {
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

function normalizeQueryPayload(input: {
  userMessage: string;
  activeSchemas: string;
  tables: string;
  cond: string;
}): {
  cond: string;
  idDelAdded: string[];
  atendimentoTipoApplied: boolean;
} {
  const schemaIdDelColumns = parseSchemaIdDelColumns(input.activeSchemas);
  const tableRefs = parseTableReferences(input.tables);
  let cond = input.cond;
  const idDelAdded: string[] = [];

  for (const ref of tableRefs) {
    const idDelColumns = schemaIdDelColumns.get(ref.table);
    if (!idDelColumns || idDelColumns.length === 0) continue;

    const idDelColumn = idDelColumns[0];
    const alreadyHasIdDelFilter = hasCondition(cond, new RegExp(`\\b${idDelColumn}\\b\\s+IS\\s+NULL\\b`, "i"));
    if (alreadyHasIdDelFilter) continue;

    const qualifier = ref.alias || ref.table;
    const clause = `${qualifier}.${idDelColumn} IS NULL`;
    cond = injectIntoCond(cond, clause);
    idDelAdded.push(`${ref.table}.${idDelColumn}`);
  }

  let atendimentoTipoApplied = false;
  const hasAtendimento = tableRefs.some((ref) => ref.table === "ATENDIMENTO");
  const askedForBudget = userAskedForBudget(input.userMessage);
  const hasAtenTipo = hasCondition(cond, /\bATEN_STTIPO\b/i);

  if (hasAtendimento && !askedForBudget && !hasAtenTipo) {
    const atendimentoRef = tableRefs.find((ref) => ref.table === "ATENDIMENTO");
    const qualifier = atendimentoRef?.alias || "ATENDIMENTO";
    cond = injectIntoCond(cond, `${qualifier}.ATEN_STTIPO = 'V'`);
    atendimentoTipoApplied = true;
  }

  return { cond, idDelAdded, atendimentoTipoApplied };
}

export async function generateSqlQuery({ userMessage, activeSchemas }: QueryGeneratorInput): Promise<QueryGeneratorOutput> {
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY")?.trim();
  if (!geminiApiKey) {
    return {
      error: "GEMINI_API_KEY nao configurada.",
      usage: emptyUsage(),
      shouldFallback: true,
      failureCode: "missing_api_key",
      failureDetail: "GEMINI_API_KEY nao configurada.",
      retriable: false,
    };
  }

  const sanitizedUserMessage = (userMessage || "").trim();
  if (!sanitizedUserMessage) {
    return {
      error: "Mensagem vazia.",
      usage: emptyUsage(),
      shouldFallback: false,
    };
  }

  const sanitizedSchemas = (activeSchemas || "").trim();
  if (!sanitizedSchemas) {
    return {
      error: "Nao foi possivel resolver os dicionarios de dados para esta pergunta.",
      usage: emptyUsage(),
      shouldFallback: false,
    };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildSystemPrompt(sanitizedSchemas) }] },
        contents: [{ role: "user", parts: [{ text: sanitizedUserMessage }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    });

    const rawText = await response.text();
    const rawData = rawText ? safeJsonParse(rawText) : {};
    if (rawText && !rawData) {
      throw new QueryGeneratorFailure({
        message: "Query generator retornou JSON invalido.",
        code: "provider_invalid_json",
        detail: compactText(rawText),
        retriable: true,
      });
    }
    const usage = extractGeminiUsage(rawData?.usageMetadata);

    if (!response.ok) {
      throw new QueryGeneratorFailure({
        message: `Query generator Gemini falhou com status ${response.status}.`,
        code: "provider_http_error",
        status: response.status,
        detail: extractProviderErrorMessage(rawData, rawText),
        retriable: isRetriableHttpStatus(response.status),
        usage,
      });
    }

    const resultText = parseResponseText(rawData);
    if (!resultText) {
      throw new QueryGeneratorFailure({
        message: "Query generator retornou payload vazio.",
        code: "empty_result",
        detail: "Resposta sem campo de texto util no candidate principal.",
        retriable: true,
        usage,
      });
    }

    const parsed = safeJsonParse(resultText);
    if (!parsed) {
      throw new QueryGeneratorFailure({
        message: "Payload do query generator nao e JSON valido.",
        code: "result_invalid_json",
        detail: compactText(resultText),
        retriable: true,
        usage,
      });
    }

    const domainError = toTrimmedString(parsed?.error);
    if (domainError) {
      return {
        error: domainError,
        usage,
        shouldFallback: false,
      };
    }

    const fields = toTrimmedString(parsed?.fields);
    const tables = toTrimmedString(parsed?.tables);
    const rawCond = toTrimmedString(parsed?.cond);

    if (!fields || !tables || !rawCond) {
      throw new QueryGeneratorFailure({
        message: "Payload do gerador veio sem fields/tables/cond.",
        code: "incomplete_payload",
        detail: compactText(resultText),
        retriable: true,
        usage,
      });
    }

    const normalizedPayload = normalizeQueryPayload({
      userMessage: sanitizedUserMessage,
      activeSchemas: sanitizedSchemas,
      tables,
      cond: rawCond,
    });
    const cond = normalizedPayload.cond;

    let order = toTrimmedString(parsed?.order);
    if (!order || containsPositionalOrder(order)) {
      const reason = order ? "positional" : "missing";
      order = buildOrderFallback(fields, cond, tables);
      console.log(
        `[ORDER_FALLBACK] reason=${reason} orderFinal=${order} fields=${sanitizeForLog(
          fields,
          160,
        )} cond=${sanitizeForLog(cond, 160)}`,
      );
    }

    if (normalizedPayload.idDelAdded.length > 0 || normalizedPayload.atendimentoTipoApplied) {
      console.log(
        `[QUERY_NORMALIZED] idDelAdded=${normalizedPayload.idDelAdded.join(",") || "none"} atendimentoTipoApplied=${normalizedPayload.atendimentoTipoApplied}`,
      );
    }

    return {
      fields,
      tables,
      cond,
      order,
      rowspPage: toRowspPage(parsed?.rowspPage),
      chart_type: normalizeChartType(parsed?.chart_type),
      chart_title: toTrimmedString(parsed?.chart_title),
      usage,
      shouldFallback: false,
    };
  } catch (error) {
    if (error instanceof QueryGeneratorFailure) {
      console.warn("Erro no Query Generator Swarm:", {
        code: error.code,
        status: error.status ?? null,
        retriable: error.retriable,
        detail: compactText(error.detail || error.message),
      });
      return {
        error: "Falha interna ao montar consulta SQL Server.",
        usage: error.usage || emptyUsage(),
        shouldFallback: true,
        failureCode: error.code,
        failureDetail: compactText(error.detail || error.message),
        failureHttpStatus: error.status,
        retriable: error.retriable,
      };
    }

    const rawMessage = error instanceof Error ? error.message : String(error);
    const normalizedMessage = compactText(rawMessage);
    const looksNetworkError =
      error instanceof TypeError ||
      /\b(network|fetch|timeout|timed out|socket|dns|enotfound|econnrefused)\b/i.test(normalizedMessage);
    const failureCode = looksNetworkError ? "network_error" : "unexpected_error";
    console.warn("Erro no Query Generator Swarm:", error);
    return {
      error: "Falha interna ao montar consulta SQL Server.",
      usage: emptyUsage(),
      shouldFallback: true,
      failureCode,
      failureDetail: normalizedMessage,
      retriable: true,
    };
  }
}
