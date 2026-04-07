import http from "node:http";
import https from "node:https";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const DEFAULT_ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type, x-request-id, x-internal-proxy-key";
const PRIVATE_IPV4_RANGES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
];
const AUTH_RETRY_DELAYS_MS = [0, 200, 400];
const DEFAULT_AUTH_TIMEOUT_MS = 4500;
const DEFAULT_AUTH_CACHE_MAX_AGE_SEC = 300;
const proxyRequestSchema = z.object({
  fields: z.string().min(1),
  tables: z.string().min(1),
  cond: z.string().min(1),
  order: z.string().optional(),
  pageNumber: z.union([z.number(), z.string()]).optional(),
  rowspPage: z.union([z.number(), z.string()]).optional(),
  empresa: z.union([z.number(), z.string()]).optional(),
  debug: z.boolean().optional(),
});

let cachedDelphiAuthToken = null;

function env(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
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

function createJsonResponse(res, status, payload, req, extraHeaders = {}) {
  const origin = req.headers.origin || null;
  res.writeHead(status, {
    ...createCorsHeaders(origin),
    "Content-Type": "application/json",
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function getRequestId(req) {
  const existing = req.headers["x-request-id"];
  return typeof existing === "string" && existing.trim() ? existing.trim() : randomUUID();
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve(Buffer.alloc(0));
        return;
      }
      resolve(Buffer.concat(chunks));
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

function isPrivateIp(ip) {
  return PRIVATE_IPV4_RANGES.some((regex) => regex.test(ip));
}

function isIpLiteral(hostname) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function normalizeAllowlistEntry(entry) {
  const trimmed = entry.trim().toLowerCase();
  if (!trimmed) return [];

  if (trimmed.includes("://")) {
    try {
      const parsed = new URL(trimmed);
      return [parsed.hostname.toLowerCase(), parsed.host.toLowerCase(), parsed.origin.toLowerCase()];
    } catch {
      return [trimmed];
    }
  }

  return [trimmed];
}

function assertOutboundUrlAllowed(rawUrl, allowlist) {
  const parsed = new URL(rawUrl);
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("A URL de destino deve usar HTTP/HTTPS.");
  }

  const hostname = parsed.hostname.toLowerCase();
  const host = parsed.host.toLowerCase();
  const origin = parsed.origin.toLowerCase();
  const normalizedAllowlist = allowlist.flatMap((entry) => normalizeAllowlistEntry(entry)).filter(Boolean);
  const allowed = normalizedAllowlist.some((entry) => entry === hostname || entry === host || entry === origin);

  if (!allowed) {
    throw new Error("Host de destino nao permitido pelo allowlist.");
  }

  if (isIpLiteral(hostname) && isPrivateIp(hostname)) {
    throw new Error("Endereco IP privado/loopback nao permitido.");
  }

  return parsed;
}

function toJsonObject(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function compactResponseSnippet(value, maxLength = 160) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function classifyAuthResponseBody(rawBody) {
  const parsed = toJsonObject(rawBody);
  if (!parsed) {
    return {
      kind: rawBody.trim() ? "non_json" : "empty",
      keys: [],
      snippet: compactResponseSnippet(rawBody),
    };
  }

  return {
    kind: "json_object",
    keys: Object.keys(parsed).slice(0, 5),
    snippet: "",
  };
}

function redactTokenApiInText(value) {
  return (value || "").replace(/tokenapi=([^&\s]+)/gi, "tokenapi=[redacted]");
}

function classifyNetworkError(detail) {
  const normalized = detail.toLowerCase();
  if (normalized.includes("certificate") || normalized.includes("tls") || normalized.includes("handshake")) {
    return "auth_tls_error";
  }
  if (normalized.includes("dns") || normalized.includes("resolve") || normalized.includes("hostname")) {
    return "auth_dns_error";
  }
  if (normalized.includes("refused") || normalized.includes("connection reset") || normalized.includes("econnrefused")) {
    return "auth_connection_refused";
  }
  if (normalized.includes("timed out") || normalized.includes("timeout") || normalized.includes("abort")) {
    return "auth_timeout";
  }
  if (normalized.includes("network") || normalized.includes("fetch")) {
    return "auth_network_error";
  }
  return "auth_network_error";
}

function shouldUseCachedToken(cacheMaxAgeSec, nowMs) {
  if (!cachedDelphiAuthToken) return false;
  const ageMs = nowMs - cachedDelphiAuthToken.acquiredAtMs;
  return ageMs >= 0 && ageMs <= cacheMaxAgeSec * 1000;
}

function sleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toStringWithFallback(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function toOptionalNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toPositiveIntEnvValue(name, fallback) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

function escapeMultipartName(name) {
  return name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function mergeUint8Arrays(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function buildMultipartFormData(fields) {
  const boundary = `----codex${randomUUID().replace(/-/g, "")}`;
  const encoder = new TextEncoder();
  const parts = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${escapeMultipartName(name)}"\r\n\r\n${value}\r\n`,
      ),
    );
  }

  parts.push(encoder.encode(`--${boundary}--\r\n`));
  return {
    body: mergeUint8Arrays(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function httpRequestWithTls12(urlInput, init = {}) {
  const url = urlInput instanceof URL ? urlInput : new URL(String(urlInput));
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers();
  if (init.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }

  let bodyBytes = null;
  const initBody = init.body;
  if (initBody != null) {
    if (typeof initBody === "string") {
      bodyBytes = new TextEncoder().encode(initBody);
    } else if (initBody instanceof Uint8Array) {
      bodyBytes = initBody;
    } else if (initBody instanceof ArrayBuffer) {
      bodyBytes = new Uint8Array(initBody);
    } else if (initBody instanceof URLSearchParams) {
      const encoded = initBody.toString();
      bodyBytes = new TextEncoder().encode(encoded);
      if (!headers.has("content-type")) headers.set("content-type", "application/x-www-form-urlencoded");
    } else if (initBody instanceof FormData) {
      const fields = {};
      initBody.forEach((value, key) => {
        fields[key] = typeof value === "string" ? value : String(value);
      });
      const encoded = buildMultipartFormData(fields);
      bodyBytes = encoded.body;
      if (!headers.has("content-type")) headers.set("content-type", encoded.contentType);
    } else {
      bodyBytes = new TextEncoder().encode(String(initBody));
    }
  }

  if (bodyBytes && !headers.has("content-length")) {
    headers.set("content-length", String(bodyBytes.byteLength));
  }
  if (!headers.has("connection")) {
    headers.set("connection", "close");
  }
  if (!headers.has("host")) {
    headers.set("host", url.port ? `${url.hostname}:${url.port}` : url.hostname);
  }

  const requestHeaders = {};
  headers.forEach((value, key) => {
    requestHeaders[key] = value;
  });

  const client = url.protocol === "http:" ? http : https;

  return new Promise((resolve, reject) => {
    const requestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      path: `${url.pathname}${url.search}`,
      method,
      headers: requestHeaders,
    };

    if (url.protocol === "https:") {
      requestOptions.secureProtocol = "TLSv1_2_method";
    }

    const req = client.request(requestOptions, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) {
            responseHeaders.set(key, value.join(", "));
          } else if (typeof value === "string") {
            responseHeaders.set(key, value);
          }
        }

        resolve({
          status: res.statusCode || 500,
          headers: responseHeaders,
          ok: (res.statusCode || 500) >= 200 && (res.statusCode || 500) < 300,
          text: async () => rawBody,
        });
      });
    });

    if (init.signal) {
      if (init.signal.aborted) {
        req.destroy(new Error("request aborted"));
        reject(new Error("request aborted"));
        return;
      }
      init.signal.addEventListener(
        "abort",
        () => {
          req.destroy(new Error("request aborted"));
          reject(new Error("request aborted"));
        },
        { once: true },
      );
    }

    req.on("error", reject);

    if (bodyBytes) {
      req.write(Buffer.from(bodyBytes));
    }

    req.end();
  });
}

function buildDelphiAuthUrl(authUrlValue, tokenApiValue) {
  const authUrl = new URL(authUrlValue);
  const existingTokenApi = authUrl.searchParams.get("tokenapi")?.trim() || "";
  const fallbackTokenApi = tokenApiValue?.trim() || "";

  if (!existingTokenApi && fallbackTokenApi) {
    authUrl.searchParams.set("tokenapi", fallbackTokenApi);
  }

  if (!authUrl.searchParams.get("tokenapi")?.trim()) {
    throw new Error("DELPHI_AUTH_URL deve incluir tokenapi ou informar DELPHI_AUTH_TOKENAPI.");
  }

  return authUrl;
}

function describeSafeUrl(url) {
  return {
    host: url.host,
    origin: url.origin,
    path: url.pathname,
  };
}

async function resolveDelphiBearerToken(params) {
  const timeoutMs = params.timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
  const cacheMaxAgeSec = params.cacheMaxAgeSec ?? DEFAULT_AUTH_CACHE_MAX_AGE_SEC;
  const fallbackBearer = params.fallbackBearer?.trim() || "";
  const nowForCache = Date.now();
  const safeAuthUrl = describeSafeUrl(params.authUrl);
  const hasTokenApi = params.authUrl.searchParams.has("tokenapi");

  let lastReasonCode = "auth_unknown_failure";
  let lastAttempt = 0;
  let lastErrorName = null;
  let lastErrorMessage = null;
  let lastErrorCauseMessage = null;

  for (const [index, delayMs] of AUTH_RETRY_DELAYS_MS.entries()) {
    const attempt = index + 1;
    lastAttempt = attempt;
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort("auth timeout"), timeoutMs);

    try {
      console.log("[delphi-proxy][auth][attempt]", {
        request_id: params.requestId,
        auth_attempt: attempt,
        auth_mode: "fresh",
        auth_url_origin: safeAuthUrl.origin,
        auth_url_host: safeAuthUrl.host,
        auth_url_path: safeAuthUrl.path,
        auth_url_has_tokenapi: hasTokenApi,
        timeout_ms: timeoutMs,
      });

      const authResponse = await httpRequestWithTls12(params.authUrl, {
        method: "GET",
        signal: controller.signal,
      });

      if (authResponse.status >= 300 && authResponse.status < 400) {
        lastReasonCode = "auth_redirect_blocked";
        console.warn("[delphi-proxy][auth]", {
          request_id: params.requestId,
          auth_attempt: attempt,
          auth_mode: "fresh",
          auth_status: "failed",
          reason_code: lastReasonCode,
          http_status: authResponse.status,
          redirect_location: authResponse.headers.get("location") || null,
          auth_url_has_tokenapi: hasTokenApi,
        });
        continue;
      }

      const rawBody = await authResponse.text();
      if (!authResponse.ok) {
        lastReasonCode = `auth_http_${authResponse.status}`;
        const bodyInfo = classifyAuthResponseBody(rawBody);
        console.warn("[delphi-proxy][auth]", {
          request_id: params.requestId,
          auth_attempt: attempt,
          auth_mode: "fresh",
          auth_status: "failed",
          reason_code: lastReasonCode,
          http_status: authResponse.status,
          content_type: authResponse.headers.get("content-type") || null,
          body_kind: bodyInfo.kind,
          body_keys: bodyInfo.keys,
          body_snippet: bodyInfo.snippet || null,
          auth_url_has_tokenapi: hasTokenApi,
        });
        continue;
      }

      const parsedBody = toJsonObject(rawBody);
      const token = typeof parsedBody?.token === "string" ? parsedBody.token.trim() : "";
      if (!token) {
        lastReasonCode = "auth_token_missing";
        const bodyInfo = classifyAuthResponseBody(rawBody);
        console.warn("[delphi-proxy][auth]", {
          request_id: params.requestId,
          auth_attempt: attempt,
          auth_mode: "fresh",
          auth_status: "failed",
          reason_code: lastReasonCode,
          http_status: authResponse.status,
          content_type: authResponse.headers.get("content-type") || null,
          body_kind: bodyInfo.kind,
          body_keys: bodyInfo.keys,
          body_snippet: bodyInfo.snippet || null,
          auth_url_has_tokenapi: hasTokenApi,
        });
        continue;
      }

      cachedDelphiAuthToken = { token, acquiredAtMs: Date.now() };
      console.log("[delphi-proxy][auth]", {
        request_id: params.requestId,
        auth_attempt: attempt,
        auth_mode: "fresh",
        auth_status: "ok",
        http_status: authResponse.status,
        content_type: authResponse.headers.get("content-type") || null,
      });
      return {
        token,
        authMode: "fresh",
        authAttempt: attempt,
      };
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "unknown";
      const errorMessage = redactTokenApiInText(error instanceof Error ? error.message : String(error));
      const cause = error instanceof Error && "cause" in error ? error.cause : null;
      const causeMessage = cause instanceof Error
        ? redactTokenApiInText(cause.message)
        : cause
        ? redactTokenApiInText(String(cause))
        : null;
      const combinedDetail = [errorName, errorMessage, causeMessage].filter(Boolean).join(" | ");
      lastReasonCode = classifyNetworkError(combinedDetail);
      lastErrorName = errorName;
      lastErrorMessage = errorMessage;
      lastErrorCauseMessage = causeMessage;
      console.warn("[delphi-proxy][auth]", {
        request_id: params.requestId,
        auth_attempt: attempt,
        auth_mode: "fresh",
        auth_status: "failed",
        reason_code: lastReasonCode,
        auth_url_origin: safeAuthUrl.origin,
        auth_url_host: safeAuthUrl.host,
        auth_url_path: safeAuthUrl.path,
        auth_url_has_tokenapi: hasTokenApi,
        error_name: errorName,
        error_message: errorMessage,
        error_cause_message: causeMessage,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (shouldUseCachedToken(cacheMaxAgeSec, nowForCache) && cachedDelphiAuthToken) {
    const cacheAgeSec = Math.max(0, Math.floor((nowForCache - cachedDelphiAuthToken.acquiredAtMs) / 1000));
    console.warn("[delphi-proxy][auth]", {
      request_id: params.requestId,
      auth_attempt: lastAttempt,
      auth_mode: "cache_fallback",
      auth_status: "ok",
      reason_code: "cache_fallback",
      cache_age_sec: cacheAgeSec,
      auth_url_origin: safeAuthUrl.origin,
      auth_url_host: safeAuthUrl.host,
      auth_url_path: safeAuthUrl.path,
      auth_url_has_tokenapi: hasTokenApi,
    });
    return {
      token: cachedDelphiAuthToken.token,
      authMode: "cache_fallback",
      authAttempt: lastAttempt,
    };
  }

  const canUseStaticFallback =
    fallbackBearer &&
    ["auth_tls_error", "auth_dns_error", "auth_timeout", "auth_network_error", "auth_connection_refused"].includes(lastReasonCode);

  if (canUseStaticFallback) {
    console.warn("[delphi-proxy][auth]", {
      request_id: params.requestId,
      auth_attempt: lastAttempt,
      auth_mode: "env_fallback",
      auth_status: "ok",
      reason_code: "env_fallback",
      auth_url_origin: safeAuthUrl.origin,
      auth_url_host: safeAuthUrl.host,
      auth_url_path: safeAuthUrl.path,
      auth_url_has_tokenapi: hasTokenApi,
      last_reason_code: lastReasonCode,
    });
    return {
      token: fallbackBearer,
      authMode: "env_fallback",
      authAttempt: lastAttempt,
    };
  }

  const error = new Error("Nao foi possivel autenticar no Delphi no momento. Tente novamente em instantes.");
  error.name = "DelphiAuthError";
  error.statusCode = 502;
  error.reasonCode = lastReasonCode;
  error.details = {
    auth_url_origin: safeAuthUrl.origin,
    auth_url_host: safeAuthUrl.host,
    auth_url_path: safeAuthUrl.path,
    auth_url_has_tokenapi: hasTokenApi,
    last_error_name: lastErrorName,
    last_error_message: lastErrorMessage,
    last_error_cause_message: lastErrorCauseMessage,
  };
  throw error;
}

function requireInternalProxyKey(req) {
  const expected = env("INTERNAL_PROXY_KEY");
  if (!expected) {
    throw new Error("INTERNAL_PROXY_KEY nao configurado.");
  }

  const provided = req.headers["x-internal-proxy-key"];
  if (!provided || Array.isArray(provided) || provided.trim() !== expected) {
    throw new Error("Missing or invalid internal proxy key.");
  }
}

function setRateLimitInternalState() {
  if (!globalThis.__delphiProxyRateLimit) {
    globalThis.__delphiProxyRateLimit = new Map();
  }
  return globalThis.__delphiProxyRateLimit;
}

function rateLimitInternal(requestKey = "external-db-proxy:internal") {
  const windowSec = Number(env("RATE_LIMIT_WINDOW_SEC", "60"));
  const maxReq = Number(env("RATE_LIMIT_MAX_REQ", "60"));
  const safeWindow = Number.isFinite(windowSec) && windowSec > 0 ? Math.round(windowSec) : 60;
  const safeMax = Number.isFinite(maxReq) && maxReq > 0 ? Math.round(maxReq) : 60;
  const store = setRateLimitInternalState();
  const now = Date.now();
  const current = store.get(requestKey);

  if (!current || current.resetAt <= now) {
    const next = { count: 1, resetAt: now + safeWindow * 1000 };
    store.set(requestKey, next);
    return { allowed: true, remaining: safeMax - 1, resetAtEpochMs: next.resetAt };
  }

  current.count += 1;
  store.set(requestKey, current);
  return {
    allowed: current.count <= safeMax,
    remaining: Math.max(0, safeMax - current.count),
    resetAtEpochMs: current.resetAt,
  };
}

async function handleProxyRequest(req, res) {
  if (req.method === "OPTIONS") {
    const origin = req.headers.origin || null;
    res.writeHead(204, createCorsHeaders(origin));
    res.end();
    return;
  }

  if (req.method !== "POST") {
    createJsonResponse(res, 405, { error: "Metodo nao permitido. Use POST." }, req);
    return;
  }

  const requestId = getRequestId(req);
  let requestBody = null;
  let requestPhase = "request_validation";
  let authResolutionInfo = null;

  try {
    requireInternalProxyKey(req);
    const rateLimit = rateLimitInternal();
    if (!rateLimit.allowed) {
      createJsonResponse(
        res,
        429,
        { error: "Rate limit excedido.", request_id: requestId, reset_at: rateLimit.resetAtEpochMs },
        req,
      );
      return;
    }

    const delphiApiUrl = env("DELPHI_API_URL");
    const delphiApiToken = env("DELPHI_API_TOKEN");
    const delphiAuthUrl = env("DELPHI_AUTH_URL");
    const delphiAuthTokenApi = env("DELPHI_AUTH_TOKENAPI");
    const delphiAuthBearer = env("DELPHI_AUTH_BEARER");
    const allowedProxyHosts = env("ALLOWED_PROXY_HOSTS", "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (!delphiApiUrl || !delphiApiToken || !delphiAuthUrl) {
      createJsonResponse(
        res,
        500,
        {
          success: false,
          data: [],
          rowCount: 0,
          error: "Segredos DELPHI_API_URL, DELPHI_API_TOKEN e DELPHI_AUTH_URL sao obrigatorios.",
        },
        req,
      );
      return;
    }

    const effectiveAllowlist = [...allowedProxyHosts, delphiApiUrl, delphiAuthUrl];
    const validatedUrl = assertOutboundUrlAllowed(delphiApiUrl, effectiveAllowlist);
    const normalizedAuthUrl = buildDelphiAuthUrl(delphiAuthUrl, delphiAuthTokenApi);
    const validatedAuthUrl = assertOutboundUrlAllowed(normalizedAuthUrl.toString(), effectiveAllowlist);

    const rawBody = await readRequestBody(req);
    requestBody = rawBody.length > 0 ? JSON.parse(rawBody.toString("utf8")) : {};
    const parsedBody = proxyRequestSchema.safeParse(requestBody);
    if (!parsedBody.success) {
      createJsonResponse(
        res,
        400,
        { error: `Payload invalido: ${parsedBody.error.errors.map((e) => e.message).join("; ")}`, request_id: requestId },
        req,
      );
      return;
    }
    requestBody = parsedBody.data;

    const order = toStringWithFallback(requestBody.order, "");
    const pageNumber = toStringWithFallback(requestBody.pageNumber, "1");
    const rowspPage = toStringWithFallback(requestBody.rowspPage, "15");
    const empresa = toStringWithFallback(requestBody.empresa, "1");

    const params = new FormData();
    params.append("function", "1");
    params.append("TokenAPI", delphiApiToken);
    params.append("fields", requestBody.fields.trim());
    params.append("tables", requestBody.tables.trim());
    params.append("cond", requestBody.cond.trim());
    params.append("order", order);
    params.append("pagenumber", pageNumber);
    params.append("RowspPage", rowspPage);
    params.append("empresa", empresa);

    const authTimeoutMs = toPositiveIntEnvValue("DELPHI_AUTH_TIMEOUT_MS", DEFAULT_AUTH_TIMEOUT_MS);
    const authCacheMaxAgeSec = toPositiveIntEnvValue("DELPHI_AUTH_CACHE_MAX_AGE_SEC", DEFAULT_AUTH_CACHE_MAX_AGE_SEC);
    requestPhase = "auth";
    const authResolution = await resolveDelphiBearerToken({
      authUrl: validatedAuthUrl,
      requestId,
      timeoutMs: authTimeoutMs,
      cacheMaxAgeSec: authCacheMaxAgeSec,
      fallbackBearer: delphiAuthBearer,
    });
    authResolutionInfo = authResolution;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("upstream timeout"), 12000);

    const headers = {
      Authorization: `Bearer ${authResolution.token}`,
    };
    console.log("[delphi-proxy][delphi_request]", {
      request_id: requestId,
      auth_mode: authResolution.authMode,
      auth_status: "ok",
    });

    requestPhase = "delphi";
    const delphiResponse = await httpRequestWithTls12(validatedUrl, {
      method: "POST",
      headers,
      body: params,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (delphiResponse.status >= 300 && delphiResponse.status < 400) {
      createJsonResponse(
        res,
        502,
        { success: false, data: [], rowCount: 0, error: "Redirect externo nao permitido.", request_id: requestId },
        req,
        { "x-request-id": requestId },
      );
      return;
    }

    const responseText = await delphiResponse.text();
    if (requestBody.debug === true) {
      createJsonResponse(
        res,
        200,
        { _debug: true, _status: delphiResponse.status, _raw: responseText, request_id: requestId },
        req,
      );
      return;
    }

    let upstreamBody = null;
    try {
      const candidate = responseText ? JSON.parse(responseText) : null;
      upstreamBody = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate : null;
    } catch {
      upstreamBody = null;
    }

    if (!delphiResponse.ok) {
      createJsonResponse(
        res,
        502,
        {
          success: false,
          data: [],
          rowCount: 0,
          error: typeof upstreamBody?.error === "string" ? upstreamBody.error : responseText || `Erro upstream (${delphiResponse.status}).`,
          request_id: requestId,
        },
        req,
      );
      return;
    }

    const resultNode = Array.isArray(upstreamBody?.RESULT) ? upstreamBody.RESULT[0] : null;
    const rows = Array.isArray(resultNode?.data) ? resultNode.data.filter((item) => item && typeof item === "object") : [];
    const pageNumberValue = toOptionalNumber(resultNode?.pageNumber);
    const totalPagesValue = toOptionalNumber(resultNode?.totalPages);
    const totalRecValue = toOptionalNumber(resultNode?.totalRec);

    const responsePayload = {
      success: true,
      data: rows,
      rowCount: rows.length,
      request_id: requestId,
    };

    if (pageNumberValue !== null && totalPagesValue !== null && totalRecValue !== null) {
      responsePayload.pagination = {
        pageNumber: pageNumberValue,
        totalPages: totalPagesValue,
        totalRec: totalRecValue,
      };
    }

    requestPhase = "complete";
    createJsonResponse(res, 200, responsePayload, req, { "x-request-id": requestId });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "unknown";
    const message = error instanceof Error ? error.message : "Erro interno no proxy Delphi.";
    const statusCode = errorName === "DelphiAuthError" ? error.statusCode || 502 : 500;
    const debugDetails = requestBody?.debug === true
      ? {
        error_name: errorName,
        error_message: message,
        request_phase: requestPhase,
        auth_resolution: authResolutionInfo,
        reason_code: errorName === "DelphiAuthError" ? error.reasonCode || null : null,
        error_details: errorName === "DelphiAuthError" ? error.details || null : null,
      }
      : undefined;
    createJsonResponse(
      res,
      statusCode,
      debugDetails
        ? { success: false, data: [], rowCount: 0, error: message, debug: debugDetails, request_id: requestId }
        : { success: false, data: [], rowCount: 0, error: message, request_id: requestId },
      req,
      { "x-request-id": requestId },
    );
  }
}

function handleHealthRequest(req, res) {
  createJsonResponse(
    res,
    200,
    {
      status: "ok",
      service: "delphi-proxy",
      timestamp: new Date().toISOString(),
    },
    req,
  );
}

const port = Number(env("PORT", "8787"));
const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === "/health") {
    handleHealthRequest(req, res);
    return;
  }

  if (url.pathname === "/external-db-proxy" || url.pathname === "/api/external-db-proxy") {
    handleProxyRequest(req, res);
    return;
  }

  createJsonResponse(res, 404, { error: "Not found." }, req);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[delphi-proxy] listening on 0.0.0.0:${port}`);
});

