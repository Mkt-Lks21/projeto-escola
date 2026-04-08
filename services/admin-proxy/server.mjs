import http from "node:http";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const DEFAULT_ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type, x-request-id";
const OPERATION_TABLE_ALLOWLIST = ["atendimento", "financeiro", "movimento", "produto_estoque"];
const OPERATION_TABLE_ALLOWLIST_SET = new Set(OPERATION_TABLE_ALLOWLIST);
const OPERATION_QUALIFIED_ALLOWLIST_SET = new Set(OPERATION_TABLE_ALLOWLIST.map((table) => `public.${table}`));
const FORBIDDEN_KEYWORDS = ["INSERT", "DELETE", "UPDATE", "DROP", "TRUNCATE", "ALTER", "GRANT", "REVOKE", "EXEC", "EXECUTE", "CREATE"];

const actionSchema = z.object({
  action: z.enum(["fetch-metadata", "execute-query", "test-connection"]),
  query: z.string().optional(),
});

function normalizeEnvValue(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function env(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? normalizeEnvValue(value) : fallback;
}

function getAllowedOrigins() {
  const envValue = env("ALLOWED_ORIGINS", env("APP_ORIGIN", ""));
  return envValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function createCorsHeaders(origin) {
  const allowedOrigins = getAllowedOrigins();
  const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0] || "";
  const headers = {
    "Access-Control-Allow-Headers": DEFAULT_ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };

  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
  }

  return headers;
}

function createJsonResponse(res, req, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    ...createCorsHeaders(req.headers.origin || null),
    "Content-Type": "application/json",
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function getRequestId(req) {
  const existing = req.headers["x-request-id"];
  return typeof existing === "string" && existing.trim() ? existing.trim() : crypto.randomUUID();
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function extractBearerToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || Array.isArray(authHeader)) return null;
  const [scheme, token] = authHeader.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  const normalized = token.trim();
  return normalized.length > 0 ? normalized : null;
}

async function rateLimitWithUpstash(key, windowSec, maxReq) {
  const url = env("UPSTASH_REDIS_REST_URL");
  const token = env("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) {
    return {
      allowed: true,
      remaining: maxReq,
      resetAtEpochMs: Date.now() + windowSec * 1000,
    };
  }

  const now = Date.now();
  const resetAtEpochMs = now + windowSec * 1000;
  const redisKey = `ratelimit:${key}`;
  const pipelineUrl = `${url.replace(/\/+$/, "")}/pipeline`;

  try {
    const pipelineRes = await fetch(pipelineUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", redisKey],
        ["EXPIRE", redisKey, windowSec],
        ["TTL", redisKey],
      ]),
    });

    if (!pipelineRes.ok) {
      return { allowed: true, remaining: maxReq, resetAtEpochMs };
    }

    const json = await pipelineRes.json();
    const count = Number(json?.[0]?.result ?? 0);
    const ttl = Number(json?.[2]?.result ?? windowSec);
    const safeTtl = Number.isFinite(ttl) && ttl > 0 ? ttl : windowSec;
    const remaining = Math.max(0, maxReq - count);
    return {
      allowed: count <= maxReq,
      remaining,
      resetAtEpochMs: Date.now() + safeTtl * 1000,
    };
  } catch {
    return { allowed: true, remaining: maxReq, resetAtEpochMs };
  }
}

async function rateLimitByUser(userId, functionName) {
  const windowSec = Number(env("RATE_LIMIT_WINDOW_SEC", "60"));
  const maxReq = Number(env("RATE_LIMIT_MAX_REQ", "60"));
  const safeWindow = Number.isFinite(windowSec) && windowSec > 0 ? Math.round(windowSec) : 60;
  const safeMax = Number.isFinite(maxReq) && maxReq > 0 ? Math.round(maxReq) : 60;
  return rateLimitWithUpstash(`${functionName}:${userId}`, safeWindow, safeMax);
}

function sanitizeSqlQuery(query) {
  return (query || "").trim().replace(/;+\s*$/, "");
}

function isReadOnlyQuery(query) {
  const upperQuery = query.toUpperCase().trim();
  for (const keyword of FORBIDDEN_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(upperQuery)) {
      return false;
    }
  }
  return /^\s*(SELECT|WITH)\b/i.test(query);
}

function normalizeSqlForTableScan(query) {
  return (query || "")
    .replace(/--.*$/gm, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'([^']|'')*'/g, " ")
    .replace(/"/g, "")
    .toLowerCase();
}

function extractTopLevelCteNames(query) {
  const normalized = normalizeSqlForTableScan(query).trimStart();
  const result = new Set();

  if (!normalized.startsWith("with")) {
    return result;
  }

  const skipWhitespace = (value, index) => {
    let cursor = index;
    while (cursor < value.length && /\s/.test(value[cursor])) {
      cursor += 1;
    }
    return cursor;
  };

  const skipBalancedParens = (value, index) => {
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

  const readIdentifier = (value, index) => {
    const cursor = skipWhitespace(value, index);
    const match = /^[a-z_][a-z0-9_]*/.exec(value.slice(cursor));
    if (!match) return null;
    return { name: match[0], nextIndex: cursor + match[0].length };
  };

  let cursor = 4;
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

    cursor += 2;
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

function extractReferencedTables(query) {
  const normalized = normalizeSqlForTableScan(query);
  const cteNames = extractTopLevelCteNames(query);

  const tokens = [];
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

  const terminators = new Set(["where", "group", "order", "having", "limit", "union", "intersect", "except", "window", "fetch", "offset"]);
  const refs = [];
  const fromDepthStack = [];
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

      if (token.value === "," && fromDepthStack.length > 0 && fromDepthStack[fromDepthStack.length - 1] === depth) {
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

    let schema = null;
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

function validateQueryUsesOnlyAllowedTables(query) {
  const refs = extractReferencedTables(query);
  for (const ref of refs) {
    if (ref.schema && ref.schema !== "public") {
      return "Apenas dados do schema public sao permitidos.";
    }

    const qualified = `${ref.schema || "public"}.${ref.table}`.toLowerCase();
    if (!OPERATION_QUALIFIED_ALLOWLIST_SET.has(qualified)) {
      return "Essa consulta acessa dados fora de Atendimento, Financeiro, Movimentacoes e Estoque.";
    }
  }
  return null;
}

async function handleExternalDbAdmin(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, createCorsHeaders(req.headers.origin || null));
    res.end();
    return;
  }

  if (req.method !== "POST") {
    createJsonResponse(res, req, 405, { error: "Metodo nao permitido. Use POST." });
    return;
  }

  const requestId = getRequestId(req);

  try {
    const supabaseUrl = env("SUPABASE_URL");
    const supabaseServiceKey = env("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      createJsonResponse(res, req, 500, { error: "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios." });
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const accessToken = extractBearerToken(req);
    if (!accessToken) {
      createJsonResponse(res, req, 401, { error: "Missing authorization token.", request_id: requestId }, { "x-request-id": requestId });
      return;
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData?.user) {
      createJsonResponse(res, req, 401, { error: "Invalid or expired token.", request_id: requestId }, { "x-request-id": requestId });
      return;
    }

    const rateLimit = await rateLimitByUser(userData.user.id, "external-db-admin");
    if (!rateLimit.allowed) {
      createJsonResponse(
        res,
        req,
        429,
        { error: "Rate limit excedido.", request_id: requestId, reset_at: rateLimit.resetAtEpochMs },
        { "x-request-id": requestId },
      );
      return;
    }

    const externalUrl = env("EXTERNAL_SUPABASE_URL");
    const externalKey = env("EXTERNAL_SUPABASE_SERVICE_KEY");

    if (!externalUrl || !externalKey) {
      createJsonResponse(
        res,
        req,
        400,
        {
          error:
            "Credenciais do banco externo nao configuradas. Configure EXTERNAL_SUPABASE_URL e EXTERNAL_SUPABASE_SERVICE_KEY nos secrets.",
        },
      );
      return;
    }

    const body = actionSchema.parse(await readJsonBody(req));
    const externalSupabase = createClient(externalUrl, externalKey);

    if (body.action === "fetch-metadata") {
      const { data, error } = await externalSupabase.rpc("get_database_metadata");

      if (error) {
        createJsonResponse(
          res,
          req,
          200,
          {
            success: true,
            message: "Conexao estabelecida, mas funcao get_database_metadata nao existe no banco externo.",
            hint: "Execute a migracao SQL para criar a funcao no seu banco externo.",
            data: [],
            request_id: requestId,
          },
          { "x-request-id": requestId },
        );
        return;
      }

      const publicData = (data || []).filter((row) =>
        row.schema_name === "public" &&
        typeof row.table_name === "string" &&
        OPERATION_TABLE_ALLOWLIST_SET.has(row.table_name.toLowerCase())
      );

      createJsonResponse(
        res,
        req,
        200,
        { success: true, data: publicData, request_id: requestId },
        { "x-request-id": requestId },
      );
      return;
    }

    if (body.action === "execute-query") {
      if (!body.query) {
        createJsonResponse(res, req, 400, { error: "Query e obrigatoria" });
        return;
      }

      const sanitizedQuery = sanitizeSqlQuery(body.query);
      if (!sanitizedQuery) {
        createJsonResponse(res, req, 400, { error: "Query invalida." });
        return;
      }

      if (!isReadOnlyQuery(sanitizedQuery)) {
        createJsonResponse(res, req, 400, { error: "Apenas consultas de leitura (SELECT/CTE) sao permitidas." });
        return;
      }

      const accessError = validateQueryUsesOnlyAllowedTables(sanitizedQuery);
      if (accessError) {
        createJsonResponse(res, req, 400, { error: accessError });
        return;
      }

      const { data, error } = await externalSupabase.rpc("execute_safe_query", { query_text: sanitizedQuery });
      if (error) {
        createJsonResponse(res, req, 400, { error: `Erro na execucao: ${error.message}` });
        return;
      }

      createJsonResponse(
        res,
        req,
        200,
        { success: true, data, rowCount: Array.isArray(data) ? data.length : 0, request_id: requestId },
        { "x-request-id": requestId },
      );
      return;
    }

    if (body.action === "test-connection") {
      await externalSupabase.from("information_schema.tables").select("table_name").eq("table_schema", "public").limit(1);

      createJsonResponse(
        res,
        req,
        200,
        {
          success: true,
          message: "Conexao com banco externo estabelecida com sucesso!",
          url: externalUrl.replace(/^(https?:\/\/[^/]+).*/, "$1"),
          request_id: requestId,
        },
        { "x-request-id": requestId },
      );
      return;
    }

    createJsonResponse(res, req, 400, { error: "Acao invalida. Use: fetch-metadata, execute-query, ou test-connection" });
  } catch (error) {
    console.error("[admin-proxy] error:", error);
    createJsonResponse(
      res,
      req,
      500,
      { error: error instanceof Error ? error.message : "Erro ao conectar com banco externo" },
    );
  }
}

function handleHealth(req, res) {
  createJsonResponse(res, req, 200, {
    status: "ok",
    service: "admin-proxy",
    timestamp: new Date().toISOString(),
  });
}

const port = Number(env("PORT", "8788"));
const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/health") {
    handleHealth(req, res);
    return;
  }

  if (path === "/external-db-admin" || path === "/api/external-db-admin" || path === "/fetch-metadata" || path === "/api/fetch-metadata" || path === "/execute-query" || path === "/api/execute-query" || path === "/test-connection" || path === "/api/test-connection") {
    handleExternalDbAdmin(req, res);
    return;
  }

  createJsonResponse(res, req, 404, { error: "Not found." });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[admin-proxy] listening on 0.0.0.0:${port}`);
});
