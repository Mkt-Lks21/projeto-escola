import https from "node:https";
import { Buffer } from "node:buffer";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  assertOutboundUrlAllowed,
  createJsonResponse,
  enforceCors,
  getRequestId,
  parseAndValidateBody,
  rateLimitByUser,
  z,
} from "../_shared/security.ts";

const AUTH_RETRY_DELAYS_MS = [0, 200, 400] as const;
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

interface ProxyResponse {
  success: boolean;
  data: Record<string, unknown>[];
  rowCount: number;
  pagination?: {
    pageNumber: number;
    totalPages: number;
    totalRec: number;
  };
  error?: string;
  debug?: Record<string, unknown>;
}

type AuthMode = "fresh" | "cache_fallback" | "env_fallback";

type CachedDelphiAuthToken = {
  token: string;
  acquiredAtMs: number;
};

type Requester = typeof fetch;

let cachedDelphiAuthToken: CachedDelphiAuthToken | null = null;
let delphiHttpRequester: Requester = requestWithTls12;

export function resetCachedDelphiAuthTokenForTests(): void {
  cachedDelphiAuthToken = null;
}

export function setDelphiHttpRequesterForTests(requester: Requester | null): void {
  delphiHttpRequester = requester ?? requestWithTls12;
}

function describeSafeUrl(url: URL): { host: string; origin: string; path: string } {
  return {
    host: url.host,
    origin: url.origin,
    path: url.pathname,
  };
}

function buildDelphiAuthUrl(authUrlValue: string, tokenApiValue?: string): URL {
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

function compactResponseSnippet(value: string, maxLength = 160): string {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function classifyAuthResponseBody(rawBody: string): { kind: string; keys: string[]; snippet: string } {
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

function toStringWithFallback(value: unknown, fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function toOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toPositiveIntEnvValue(envName: string, fallback: number): number {
  const raw = Deno.env.get(envName);
  if (!raw || !raw.trim()) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

function toJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function compactErrorMessage(message: string, maxLength = 120): string {
  const normalized = (message || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "unknown";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function redactTokenApiInText(value: string): string {
  return (value || "").replace(/tokenapi=([^&\s]+)/gi, "tokenapi=[redacted]");
}

function classifyNetworkError(detail: string): string {
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

function shouldUseCachedToken(cacheMaxAgeSec: number, nowMs: number): boolean {
  if (!cachedDelphiAuthToken) return false;
  const ageMs = nowMs - cachedDelphiAuthToken.acquiredAtMs;
  return ageMs >= 0 && ageMs <= cacheMaxAgeSec * 1000;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toUint8Array(value: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  return new Uint8Array(value);
}

function mergeUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function escapeMultipartName(name: string): string {
  return name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildMultipartFormData(fields: Record<string, string>): { body: Uint8Array; contentType: string } {
  const boundary = `----codex${crypto.randomUUID().replace(/-/g, "")}`;
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];

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

async function requestWithTls12(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const requestUrl = input instanceof Request ? new URL(input.url) : new URL(String(input));
  const method = (init.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }

  let bodyBytes: Uint8Array | null = null;
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
      const fields: Record<string, string> = {};
      initBody.forEach((value, key) => {
        fields[key] = typeof value === "string" ? value : String(value);
      });
      const encoded = buildMultipartFormData(fields);
      bodyBytes = encoded.body;
      if (!headers.has("content-type")) headers.set("content-type", encoded.contentType);
    } else {
      bodyBytes = toUint8Array(String(initBody));
    }
  } else if (input instanceof Request && method !== "GET" && method !== "HEAD") {
    const cloned = input.clone();
    const arrayBuffer = await cloned.arrayBuffer();
    if (arrayBuffer.byteLength > 0) {
      bodyBytes = new Uint8Array(arrayBuffer);
    }
  }

  if (bodyBytes && !headers.has("content-length")) {
    headers.set("content-length", String(bodyBytes.byteLength));
  }
  if (!headers.has("connection")) {
    headers.set("connection", "close");
  }
  if (!headers.has("host")) {
    headers.set("host", requestUrl.port ? `${requestUrl.hostname}:${requestUrl.port}` : requestUrl.hostname);
  }

  const requestHeaders: Record<string, string> = {};
  headers.forEach((value, key) => {
    requestHeaders[key] = value;
  });

  return await new Promise<Response>((resolve, reject) => {
    const req = https.request(
      {
        protocol: requestUrl.protocol,
        hostname: requestUrl.hostname,
        port: requestUrl.port ? Number(requestUrl.port) : undefined,
        path: `${requestUrl.pathname}${requestUrl.search}`,
        method,
        headers: requestHeaders,
        secureProtocol: "TLSv1_2_method",
      },
      (res) => {
        const chunks: Uint8Array[] = [];
        res.on("data", (chunk) => chunks.push(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (Array.isArray(value)) {
              responseHeaders.set(key, value.join(", "));
            } else if (typeof value === "string") {
              responseHeaders.set(key, value);
            }
          }
          resolve(new Response(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), {
            status: res.statusCode || 500,
            headers: responseHeaders,
          }));
        });
      },
    );

    if (init.signal) {
      if (init.signal.aborted) {
        req.destroy(new Error("request aborted"));
        reject(new Error("request aborted"));
        return;
      }
      init.signal.addEventListener("abort", () => {
        req.destroy(new Error("request aborted"));
        reject(new Error("request aborted"));
      }, { once: true });
    }

    req.on("error", reject);

    if (bodyBytes) {
      req.write(Buffer.from(bodyBytes));
    }

    req.end();
  });
}

class DelphiAuthError extends Error {
  statusCode: number;
  reasonCode: string;
  details?: Record<string, unknown>;

  constructor(message: string, reasonCode: string, statusCode = 502, details?: Record<string, unknown>) {
    super(message);
    this.name = "DelphiAuthError";
    this.statusCode = statusCode;
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

export async function resolveDelphiBearerToken(params: {
  authUrl: URL;
  requestId: string;
  timeoutMs?: number;
  cacheMaxAgeSec?: number;
  fallbackBearer?: string;
  fetcher?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
}): Promise<{ token: string; authMode: AuthMode; authAttempt: number }> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
  const cacheMaxAgeSec = params.cacheMaxAgeSec ?? DEFAULT_AUTH_CACHE_MAX_AGE_SEC;
  const fallbackBearer = params.fallbackBearer?.trim() || "";
  const fetcher = params.fetcher ?? delphiHttpRequester;
  const sleepFn = params.sleepFn ?? sleep;
  const nowFn = params.nowFn ?? (() => Date.now());
  const nowForCache = nowFn();
  const safeAuthUrl = describeSafeUrl(params.authUrl);
  const hasTokenApi = params.authUrl.searchParams.has("tokenapi");

  let lastReasonCode = "auth_unknown_failure";
  let lastAttempt = 0;
  let lastErrorName: string | null = null;
  let lastErrorMessage: string | null = null;
  let lastErrorCauseMessage: string | null = null;

  for (const [index, delayMs] of AUTH_RETRY_DELAYS_MS.entries()) {
    const attempt = index + 1;
    lastAttempt = attempt;
    if (delayMs > 0) {
      await sleepFn(delayMs);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort("auth timeout"), timeoutMs);

    try {
      console.log("[external-db-proxy][auth][attempt]", {
        request_id: params.requestId,
        auth_attempt: attempt,
        auth_mode: "fresh",
        auth_url_origin: safeAuthUrl.origin,
        auth_url_host: safeAuthUrl.host,
        auth_url_path: safeAuthUrl.path,
        auth_url_has_tokenapi: hasTokenApi,
        timeout_ms: timeoutMs,
      });

      const authResponse = await fetcher(params.authUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });

      if (authResponse.status >= 300 && authResponse.status < 400) {
        lastReasonCode = "auth_redirect_blocked";
        console.warn("[external-db-proxy][auth]", {
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
        console.warn("[external-db-proxy][auth]", {
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
        console.warn("[external-db-proxy][auth]", {
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

      cachedDelphiAuthToken = { token, acquiredAtMs: nowFn() };
      console.log("[external-db-proxy][auth]", {
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
      const cause = error instanceof Error && "cause" in error ? (error as Error & { cause?: unknown }).cause : null;
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
      console.warn("[external-db-proxy][auth]", {
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
    console.warn("[external-db-proxy][auth]", {
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

  const canUseStaticFallback = fallbackBearer && ["auth_tls_error", "auth_dns_error", "auth_timeout", "auth_network_error", "auth_connection_refused"].includes(lastReasonCode);
  if (canUseStaticFallback) {
    console.warn("[external-db-proxy][auth]", {
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

  throw new DelphiAuthError(
    "Nao foi possivel autenticar no Delphi no momento. Tente novamente em instantes.",
    lastReasonCode,
    502,
    {
      auth_url_origin: safeAuthUrl.origin,
      auth_url_host: safeAuthUrl.host,
      auth_url_path: safeAuthUrl.path,
      auth_url_has_tokenapi: hasTokenApi,
      last_error_name: lastErrorName,
      last_error_message: lastErrorMessage,
      last_error_cause_message: lastErrorCauseMessage,
    },
  );
}

function createPayloadResponse(payload: ProxyResponse, status: number, req: Request, requestId: string): Response {
  return createJsonResponse({ ...payload, request_id: requestId }, status, req, { "x-request-id": requestId });
}

export function requireInternalProxyKey(req: Request): string {
  const expected = Deno.env.get("INTERNAL_PROXY_KEY")?.trim();
  if (!expected) {
    throw new Error("INTERNAL_PROXY_KEY nao configurado.");
  }

  const provided = req.headers.get("x-internal-proxy-key")?.trim();
  if (!provided || provided !== expected) {
    throw new Error("Missing or invalid internal proxy key.");
  }

  return expected;
}

export async function handleExternalDbProxyRequest(req: Request): Promise<Response> {
  const corsResponse = enforceCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return createJsonResponse({ error: "Metodo nao permitido. Use POST." }, 405, req);
  }

  const requestId = getRequestId(req);
  let requestBody: z.infer<typeof proxyRequestSchema> | null = null;
  let requestPhase: "request_validation" | "auth" | "delphi" | "complete" = "request_validation";
  let authResolutionInfo: { authMode: AuthMode; authAttempt: number } | null = null;

  try {
    requireInternalProxyKey(req);
    const rateLimit = await rateLimitByUser("internal", "external-db-proxy");
    if (!rateLimit.allowed) {
      return createJsonResponse(
        { error: "Rate limit excedido.", request_id: requestId, reset_at: rateLimit.resetAtEpochMs },
        429,
        req,
      );
    }

    const delphiApiUrl = Deno.env.get("DELPHI_API_URL")?.trim();
    const delphiApiToken = Deno.env.get("DELPHI_API_TOKEN")?.trim();
    const delphiAuthUrl = Deno.env.get("DELPHI_AUTH_URL")?.trim();
    const delphiAuthTokenApi = Deno.env.get("DELPHI_AUTH_TOKENAPI")?.trim();
    const delphiAuthBearer = Deno.env.get("DELPHI_AUTH_BEARER")?.trim();
    const allowedProxyHosts = (Deno.env.get("ALLOWED_PROXY_HOSTS") || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (!delphiApiUrl || !delphiApiToken || !delphiAuthUrl) {
      return createPayloadResponse(
        {
          success: false,
          data: [],
          rowCount: 0,
          error: "Segredos DELPHI_API_URL, DELPHI_API_TOKEN e DELPHI_AUTH_URL sao obrigatorios.",
        },
        500,
        req,
        requestId,
      );
    }

    const effectiveAllowlist = [...allowedProxyHosts, delphiApiUrl, delphiAuthUrl];
    const validatedUrl = assertOutboundUrlAllowed(delphiApiUrl, effectiveAllowlist);
    const normalizedAuthUrl = buildDelphiAuthUrl(delphiAuthUrl, delphiAuthTokenApi);
    const validatedAuthUrl = assertOutboundUrlAllowed(normalizedAuthUrl.toString(), effectiveAllowlist);
    requestBody = await parseAndValidateBody(req, proxyRequestSchema);

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

    const headers: Record<string, string> = {
      Authorization: `Bearer ${authResolution.token}`,
    };
    console.log("[external-db-proxy][delphi_request]", {
      request_id: requestId,
      auth_mode: authResolution.authMode,
      auth_status: "ok",
    });

    requestPhase = "delphi";
    const delphiResponse = await delphiHttpRequester(validatedUrl, {
      method: "POST",
      headers,
      body: params,
      redirect: "manual",
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (delphiResponse.status >= 300 && delphiResponse.status < 400) {
      return createPayloadResponse(
        { success: false, data: [], rowCount: 0, error: "Redirect externo nao permitido." },
        502,
        req,
        requestId,
      );
    }

    const rawBody = await delphiResponse.text();
    if (requestBody.debug === true) {
      return createJsonResponse(
        { _debug: true, _status: delphiResponse.status, _raw: rawBody, request_id: requestId },
        200,
        req,
      );
    }

    let upstreamBody: Record<string, unknown> | null = null;
    try {
      const candidate = rawBody ? JSON.parse(rawBody) : null;
      upstreamBody = candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? (candidate as Record<string, unknown>)
        : null;
    } catch {
      upstreamBody = null;
    }

    if (!delphiResponse.ok) {
      return createPayloadResponse(
        {
          success: false,
          data: [],
          rowCount: 0,
          error: typeof upstreamBody?.error === "string" ? upstreamBody.error : rawBody || `Erro upstream (${delphiResponse.status}).`,
        },
        502,
        req,
        requestId,
      );
    }

    const resultNode = Array.isArray(upstreamBody?.RESULT) ? upstreamBody.RESULT[0] : null;
    const rows = Array.isArray(resultNode?.data)
      ? resultNode.data.filter((item: unknown) => item && typeof item === "object")
      : [];

    const pageNumberValue = toOptionalNumber(resultNode?.pageNumber);
    const totalPagesValue = toOptionalNumber(resultNode?.totalPages);
    const totalRecValue = toOptionalNumber(resultNode?.totalRec);

    const responsePayload: ProxyResponse = {
      success: true,
      data: rows as Record<string, unknown>[],
      rowCount: rows.length,
    };

    if (pageNumberValue !== null && totalPagesValue !== null && totalRecValue !== null) {
      responsePayload.pagination = {
        pageNumber: pageNumberValue,
        totalPages: totalPagesValue,
        totalRec: totalRecValue,
      };
    }

    requestPhase = "complete";
    return createPayloadResponse(responsePayload, 200, req, requestId);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "unknown";
    const message = error instanceof Error ? error.message : "Erro interno no proxy Delphi.";
    const statusCode = error instanceof DelphiAuthError ? error.statusCode : 500;
    const debugDetails = requestBody?.debug === true
      ? {
        error_name: errorName,
        error_message: message,
        request_phase: requestPhase,
        auth_resolution: authResolutionInfo,
        reason_code: error instanceof DelphiAuthError ? error.reasonCode : null,
        error_details: error instanceof DelphiAuthError ? error.details || null : null,
      }
      : undefined;
    return createPayloadResponse(
      debugDetails
        ? { success: false, data: [], rowCount: 0, error: message, debug: debugDetails }
        : { success: false, data: [], rowCount: 0, error: message },
      statusCode,
      req,
      requestId,
    );
  }
}

if (import.meta.main) {
  serve(handleExternalDbProxyRequest);
}
