import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPERATION_TABLE_ALLOWLIST = [
  "atendimento",
  "financeiro",
  "movimento",
  "produto_estoque",
];

const OPERATION_TABLE_ALLOWLIST_SET = new Set(OPERATION_TABLE_ALLOWLIST);
const OPERATION_QUALIFIED_ALLOWLIST_SET = new Set(
  OPERATION_TABLE_ALLOWLIST.map((table) => `public.${table}`),
);

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

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader) return null;

  const [scheme, token] = authHeader.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token.trim() || null;
}

type TableReference = { schema: string | null; table: string };

function sanitizeSqlQuery(query: string): string {
  return (query || "").trim().replace(/;+\s*$/, "");
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

function normalizeSqlForTableScan(query: string): string {
  return (query || "")
    .replace(/--.*$/gm, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'([^']|'')*'/g, " ")
    .replace(/"/g, "")
    .toLowerCase();
}

function extractTopLevelCteNames(query: string): Set<string> {
  const normalized = normalizeSqlForTableScan(query).trimStart();
  const result = new Set<string>();

  if (!normalized.startsWith("with")) {
    return result;
  }

  const skipWhitespace = (value: string, index: number) => {
    let cursor = index;
    while (cursor < value.length && /\s/.test(value[cursor])) {
      cursor += 1;
    }
    return cursor;
  };

  const skipBalancedParens = (value: string, index: number) => {
    let cursor = index;
    if (value[cursor] !== "(") return cursor;

    let depth = 0;
    while (cursor < value.length) {
      const ch = value[cursor];
      if (ch === "(") depth += 1;
      if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          cursor += 1;
          break;
        }
      }
      cursor += 1;
    }
    return cursor;
  };

  const readIdentifier = (value: string, index: number) => {
    const cursor = skipWhitespace(value, index);
    const match = /^[a-z_][a-z0-9_]*/.exec(value.slice(cursor));
    if (!match) return null;
    return { name: match[0], nextIndex: cursor + match[0].length };
  };

  let cursor = 4; // "with".length
  cursor = skipWhitespace(normalized, cursor);

  if (/^recursive\b/.test(normalized.slice(cursor))) {
    cursor += "recursive".length;
    cursor = skipWhitespace(normalized, cursor);
  }

  while (cursor < normalized.length) {
    const id = readIdentifier(normalized, cursor);
    if (!id) {
      break;
    }

    result.add(id.name);
    cursor = skipWhitespace(normalized, id.nextIndex);

    if (normalized[cursor] === "(") {
      cursor = skipBalancedParens(normalized, cursor);
      cursor = skipWhitespace(normalized, cursor);
    }

    if (!/^as\b/.test(normalized.slice(cursor))) {
      break;
    }

    cursor += 2; // "as"
    cursor = skipWhitespace(normalized, cursor);

    if (normalized[cursor] === "(") {
      cursor = skipBalancedParens(normalized, cursor);
      cursor = skipWhitespace(normalized, cursor);
    }

    if (normalized[cursor] === ",") {
      cursor += 1;
      cursor = skipWhitespace(normalized, cursor);
      continue;
    }

    break;
  }

  return result;
}

function extractReferencedTables(query: string): TableReference[] {
  const normalized = normalizeSqlForTableScan(query);
  const cteNames = extractTopLevelCteNames(query);

  type Token = { type: "identifier" | "symbol"; value: string };
  const tokens: Token[] = [];

  let cursor = 0;
  while (cursor < normalized.length) {
    const ch = normalized[cursor];

    if (/\s/.test(ch)) {
      cursor += 1;
      continue;
    }

    if (ch === "(" || ch === ")" || ch === "," || ch === ".") {
      tokens.push({ type: "symbol", value: ch });
      cursor += 1;
      continue;
    }

    if (/[a-z_]/.test(ch)) {
      let end = cursor + 1;
      while (end < normalized.length && /[a-z0-9_]/.test(normalized[end])) {
        end += 1;
      }
      tokens.push({ type: "identifier", value: normalized.slice(cursor, end) });
      cursor = end;
      continue;
    }

    cursor += 1;
  }

  const terminators = new Set([
    "where",
    "group",
    "order",
    "having",
    "limit",
    "union",
    "intersect",
    "except",
    "window",
    "fetch",
    "offset",
  ]);

  const refs: TableReference[] = [];
  const fromDepthStack: number[] = [];
  let depth = 0;
  let expectRelation = false;

  const popFromDepths = () => {
    while (fromDepthStack.length > 0 && fromDepthStack[fromDepthStack.length - 1] > depth) {
      fromDepthStack.pop();
    }
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.type === "symbol") {
      if (token.value === "(") {
        if (expectRelation) {
          expectRelation = false;
        }
        depth += 1;
        continue;
      }

      if (token.value === ")") {
        depth = Math.max(0, depth - 1);
        popFromDepths();
        continue;
      }

      if (
        token.value === "," &&
        fromDepthStack.length > 0 &&
        fromDepthStack[fromDepthStack.length - 1] === depth
      ) {
        expectRelation = true;
      }

      continue;
    }

    const value = token.value;

    if (value === "from") {
      expectRelation = true;
      fromDepthStack.push(depth);
      continue;
    }

    if (value === "join") {
      expectRelation = true;
      continue;
    }

    if (terminators.has(value) && fromDepthStack.length > 0 && fromDepthStack[fromDepthStack.length - 1] === depth) {
      fromDepthStack.pop();
      expectRelation = false;
      continue;
    }

    if (!expectRelation) {
      continue;
    }

    if (value === "lateral") {
      continue;
    }

    let schema: string | null = null;
    let table = value;
    let consumed = 0;

    const dotToken = tokens[index + 1];
    const nextId = tokens[index + 2];
    if (dotToken?.type === "symbol" && dotToken.value === "." && nextId?.type === "identifier") {
      schema = value;
      table = nextId.value;
      consumed = 2;
    }

    const afterToken = tokens[index + 1 + consumed];
    if (afterToken?.type === "symbol" && afterToken.value === "(") {
      expectRelation = false;
      index += consumed;
      continue;
    }

    if (!schema && cteNames.has(table)) {
      expectRelation = false;
      index += consumed;
      continue;
    }

    refs.push({ schema, table });
    expectRelation = false;
    index += consumed;
  }

  return refs;
}

function validateQueryUsesOnlyAllowedTables(query: string): string | null {
  const refs = extractReferencedTables(query);
  for (const ref of refs) {
    if (ref.schema && ref.schema !== "public") {
      return "Apenas dados do schema public sao permitidos.";
    }

    const qualified = `${ref.schema || "public"}.${ref.table}`.toLowerCase();
    if (!OPERATION_QUALIFIED_ALLOWLIST_SET.has(qualified)) {
      return "Essa consulta acessa dados fora de Atendimento, Financeiro, Movimentações e Estoque.";
    }
  }

  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const accessToken = extractBearerToken(req);
    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const appSupabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: authData, error: authError } = await appSupabase.auth.getUser(accessToken);
    if (authError || !authData?.user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const externalUrl = Deno.env.get("EXTERNAL_SUPABASE_URL");
    const externalKey = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_KEY");

    if (!externalUrl || !externalKey) {
      return new Response(
        JSON.stringify({
          error: "Credenciais do banco externo não configuradas. Configure EXTERNAL_SUPABASE_URL e EXTERNAL_SUPABASE_SERVICE_KEY nos secrets."
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { action, query } = await req.json();
    const externalSupabase = createClient(externalUrl, externalKey);

    if (action === "fetch-metadata") {
      const { data, error } = await externalSupabase.rpc("get_database_metadata");

      if (error) {
        return new Response(
          JSON.stringify({
            success: true,
            message: "Conexão estabelecida, mas função get_database_metadata não existe no banco externo.",
            hint: "Execute a migração SQL para criar a função no seu banco externo.",
            data: []
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const publicData = (data || []).filter((row: any) =>
        row.schema_name === "public" &&
        typeof row.table_name === "string" &&
        OPERATION_TABLE_ALLOWLIST_SET.has(row.table_name.toLowerCase())
      );

      return new Response(
        JSON.stringify({ success: true, data: publicData }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "execute-query") {
      if (!query) {
        return new Response(
          JSON.stringify({ error: "Query é obrigatória" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const sanitizedQuery = sanitizeSqlQuery(query);
      if (!sanitizedQuery) {
        return new Response(
          JSON.stringify({ error: "Query inválida." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!isReadOnlyQuery(sanitizedQuery)) {
        return new Response(
          JSON.stringify({ error: "Apenas consultas de leitura (SELECT/CTE) são permitidas." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const accessError = validateQueryUsesOnlyAllowedTables(sanitizedQuery);
      if (accessError) {
        return new Response(
          JSON.stringify({ error: accessError }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data, error } = await externalSupabase.rpc("execute_safe_query", { query_text: sanitizedQuery });

      if (error) {
        return new Response(
          JSON.stringify({ error: `Erro na execução: ${error.message}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, data, rowCount: Array.isArray(data) ? data.length : 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "test-connection") {
      await externalSupabase
        .from("information_schema.tables")
        .select("table_name")
        .eq("table_schema", "public")
        .limit(1);

      return new Response(
        JSON.stringify({
          success: true,
          message: "Conexão com banco externo estabelecida com sucesso!",
          url: externalUrl.replace(/^(https?:\/\/[^/]+).*/, "$1")
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Ação inválida. Use: fetch-metadata, execute-query, ou test-connection" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("External DB proxy error:", error);
    const errorMessage = error instanceof Error ? error.message : "Erro ao conectar com banco externo";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
