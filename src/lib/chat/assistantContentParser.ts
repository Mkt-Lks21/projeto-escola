export interface ParsedSqlBlock {
  id: string;
  query: string;
  autoExecute: boolean;
}

export interface ParsedChartPayload {
  success?: boolean;
  message?: string;
  warnings?: string[];
  plotly_figure?: {
    data?: unknown[];
    layout?: Record<string, unknown>;
  };
}

export interface ParsedAssistantContent {
  plainText: string;
  sqlBlocks: ParsedSqlBlock[];
  isChartContent: boolean;
  chartPayload: ParsedChartPayload | null;
  allowSqlDebug: boolean;
}

const SQL_FENCE_REGEX = /```(?:sql|postgres|postgresql)?\s*([\s\S]*?)```/gi;
const AUTO_EXECUTE_REGEX = /\[AUTO_EXECUTE\]/gi;
const CHART_CONTENT_TAG = "[CHART_CONTENT]";

function sanitizeSql(query: string): string {
  return query.trim().replace(/;+\s*$/g, "");
}

function normalizeQuery(query: string): string {
  return sanitizeSql(query).replace(/\s+/g, " ").toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeAutoExecuteSqlFromText(text: string, blocks: ParsedSqlBlock[]): string {
  let output = text;

  for (const block of blocks) {
    const query = block.query.trim();
    if (!query) continue;

    const flexibleQueryPattern = escapeRegExp(query).replace(/\s+/g, "\\s+");
    output = output.replace(new RegExp(flexibleQueryPattern, "i"), "");
  }

  output = output.replace(/\[AUTO_EXECUTE\]\s*```(?:sql|postgres|postgresql)?\s*[\s\S]*?```/gi, "");
  output = output.replace(/\[AUTO_EXECUTE\]\s*(?:SELECT|WITH)[\s\S]*?(?=\n{2,}|$)/gi, "");
  output = output.replace(/\[AUTO_EXECUTE\]/gi, "");
  return output;
}

function stripMarkdownToPlainText(text: string): string {
  let output = text;

  output = output.replace(SQL_FENCE_REGEX, "");
  output = output.replace(AUTO_EXECUTE_REGEX, "");
  output = output.replace(/\[SQL_DEBUG_ALLOWED\]/gi, "");
  output = output.replace(/\[RESULTADO_DA_QUERY\]/gi, "");
  output = output.replace(/`([^`]+)`/g, "$1");
  output = output.replace(/\*\*([^*]+)\*\*/g, "$1");
  output = output.replace(/\*([^*]+)\*/g, "$1");
  output = output.replace(/^#{1,6}\s*/gm, "");
  output = output.replace(/^\s*[-*+]\s+/gm, "- ");
  output = output.replace(/\n{3,}/g, "\n\n");

  return output.trim();
}

function isLikelySqlLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  if (
    /^(SELECT|WITH|FROM|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|WHERE|GROUP|ORDER|HAVING|LIMIT|OFFSET|UNION|INTERSECT|EXCEPT|ON|AND|OR|AS|CASE|WHEN|THEN|ELSE|END|VALUES|DISTINCT)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }

  if (/^[,()]/.test(trimmed)) {
    return true;
  }

  if (/^[a-zA-Z0-9_".\s,=*<>!+\-/%]+$/.test(trimmed) && !/[.!?]$/.test(trimmed)) {
    return true;
  }

  return false;
}

function extractFallbackSqlAfterTag(sourceAfterTag: string): string | null {
  const trimmed = sourceAfterTag.replace(/^\s+/, "");
  const sqlStart = trimmed.search(/\b(?:SELECT|WITH)\b/i);
  if (sqlStart < 0) return null;

  const sqlRegion = trimmed.slice(sqlStart);
  const lines = sqlRegion.split(/\r?\n/);
  const selected: string[] = [];
  let started = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineTrim = line.trim();

    if (!started) {
      if (/^(SELECT|WITH)\b/i.test(lineTrim)) {
        started = true;
        selected.push(line);
      }
      continue;
    }

    if (!lineTrim) {
      const nextNonEmpty = lines.slice(i + 1).find((nextLine) => nextLine.trim().length > 0);
      if (!nextNonEmpty || !isLikelySqlLine(nextNonEmpty)) {
        break;
      }
      selected.push(line);
      continue;
    }
    if (!isLikelySqlLine(line)) break;

    selected.push(line);
  }

  const sql = sanitizeSql(selected.join("\n"));
  return sql ? sql : null;
}

function addSqlBlock(
  blocks: ParsedSqlBlock[],
  indexByNormalizedQuery: Map<string, number>,
  query: string,
  autoExecute: boolean,
): void {
  const sanitized = sanitizeSql(query);
  if (!sanitized) return;

  const normalized = normalizeQuery(sanitized);
  if (!normalized) return;

  const existingIndex = indexByNormalizedQuery.get(normalized);
  if (existingIndex !== undefined) {
    if (autoExecute) {
      blocks[existingIndex].autoExecute = true;
    }
    return;
  }

  const id = `sql-${blocks.length}`;
  blocks.push({ id, query: sanitized, autoExecute });
  indexByNormalizedQuery.set(normalized, blocks.length - 1);
}

function extractSqlCodeBlocks(
  text: string,
  blocks: ParsedSqlBlock[],
  indexByNormalizedQuery: Map<string, number>,
): void {
  let match: RegExpExecArray | null;
  const regex = /```(?:sql|postgres|postgresql)?\s*([\s\S]*?)```/gi;

  while ((match = regex.exec(text)) !== null) {
    const sql = sanitizeSql(match[1] || "");
    if (!sql || !/^(SELECT|WITH)\b/i.test(sql)) continue;
    addSqlBlock(blocks, indexByNormalizedQuery, sql, false);
  }
}

function extractAutoExecuteSql(
  text: string,
  blocks: ParsedSqlBlock[],
  indexByNormalizedQuery: Map<string, number>,
): void {
  let match: RegExpExecArray | null;
  const tagRegex = /\[AUTO_EXECUTE\]/gi;

  while ((match = tagRegex.exec(text)) !== null) {
    const start = match.index + match[0].length;
    const after = text.slice(start);

    const fencedMatch = /^\s*```(?:sql|postgres|postgresql)?\s*([\s\S]*?)```/i.exec(after);
    if (fencedMatch) {
      const sql = sanitizeSql(fencedMatch[1] || "");
      if (/^(SELECT|WITH)\b/i.test(sql)) {
        addSqlBlock(blocks, indexByNormalizedQuery, sql, true);
      }
      continue;
    }

    const fallbackSql = extractFallbackSqlAfterTag(after);
    if (fallbackSql && /^(SELECT|WITH)\b/i.test(fallbackSql)) {
      addSqlBlock(blocks, indexByNormalizedQuery, fallbackSql, true);
    }
  }
}

function parseChartPayload(raw: string): ParsedChartPayload | null {
  const markerIndex = raw.indexOf(CHART_CONTENT_TAG);
  if (markerIndex < 0) {
    return null;
  }

  const jsonCandidate = raw.slice(markerIndex + CHART_CONTENT_TAG.length).trim();
  if (!jsonCandidate) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonCandidate);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as ParsedChartPayload;
  } catch {
    return null;
  }
}

export function parseAssistantContent(content: string): ParsedAssistantContent {
  const raw = (content || "").replace(/\[RESULTADO_DA_QUERY\]/gi, "");
  const allowSqlDebug = /\[SQL_DEBUG_ALLOWED\]/i.test(raw);
  const cleanedRaw = raw.replace(/\[SQL_DEBUG_ALLOWED\]/gi, "");
  const trimmed = cleanedRaw.trimStart();
  const isChartContent = trimmed.startsWith(CHART_CONTENT_TAG);

  if (isChartContent) {
    return {
      plainText: "",
      sqlBlocks: [],
      isChartContent: true,
      chartPayload: parseChartPayload(cleanedRaw),
      allowSqlDebug: false,
    };
  }

  const blocks: ParsedSqlBlock[] = [];
  const indexByNormalizedQuery = new Map<string, number>();

  extractSqlCodeBlocks(cleanedRaw, blocks, indexByNormalizedQuery);
  extractAutoExecuteSql(cleanedRaw, blocks, indexByNormalizedQuery);

  const withoutSqlSnippets = removeAutoExecuteSqlFromText(cleanedRaw, blocks);

  if (blocks.length > 0) {
    return {
      plainText: stripMarkdownToPlainText(withoutSqlSnippets),
      sqlBlocks: blocks,
      isChartContent: false,
      chartPayload: null,
      allowSqlDebug,
    };
  }

  return {
    plainText: stripMarkdownToPlainText(cleanedRaw),
    sqlBlocks: [],
    isChartContent: false,
    chartPayload: null,
    allowSqlDebug: false,
  };
}
