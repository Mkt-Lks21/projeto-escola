import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.25.76";

const DEFAULT_ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type, x-request-id, x-internal-proxy-key";
const PRIVATE_IPV4_RANGES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
];

export type AuthenticatedUser = {
  id: string;
  email?: string | null;
};

export type SecurityContext = {
  requestId: string;
  origin: string | null;
  user: AuthenticatedUser | null;
  rateLimit: {
    allowed: boolean;
    remaining: number;
    resetAtEpochMs: number;
  } | null;
};

export function getAllowedOrigins(): string[] {
  const envValue = Deno.env.get("ALLOWED_ORIGINS") || Deno.env.get("APP_ORIGIN") || "";
  return envValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function createCorsHeaders(origin: string | null): HeadersInit {
  const allowedOrigins = getAllowedOrigins();
  const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0] || "";

  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": DEFAULT_ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };

  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
  }

  return headers;
}

export function createJsonResponse(
  payload: Record<string, unknown>,
  status: number,
  req: Request,
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

function normalizeOrigin(origin: string | null): string | null {
  if (!origin) {
    return null;
  }

  try {
    return new URL(origin).origin.toLowerCase();
  } catch {
    return null;
  }
}

function getRequestOriginCandidates(req: Request): string[] {
  const candidates = new Set<string>();
  const requestUrlOrigin = normalizeOrigin(req.url);
  if (requestUrlOrigin) {
    candidates.add(requestUrlOrigin);
  }

  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (!host) {
    return [...candidates];
  }

  const forwardedProto = req.headers
    .get("x-forwarded-proto")
    ?.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const protocols =
    forwardedProto && forwardedProto.length > 0
      ? forwardedProto
      : requestUrlOrigin
        ? [new URL(requestUrlOrigin).protocol.replace(":", "")]
        : ["http"];

  for (const protocol of protocols) {
    candidates.add(`${protocol}://${host}`.toLowerCase());
  }

  return [...candidates];
}

function isAllowedOrigin(origin: string | null, allowedOrigins: string[], req: Request): boolean {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return false;
  }

  const normalizedAllowedOrigins = allowedOrigins
    .map((allowedOrigin) => normalizeOrigin(allowedOrigin))
    .filter((value): value is string => Boolean(value));

  if (normalizedAllowedOrigins.includes(normalizedOrigin)) {
    return true;
  }

  return getRequestOriginCandidates(req).includes(normalizedOrigin);
}

export function enforceCors(req: Request): Response | null {
  const origin = req.headers.get("origin");
  const allowedOrigins = getAllowedOrigins();

  if (req.method === "OPTIONS") {
    if (origin && allowedOrigins.length > 0 && !isAllowedOrigin(origin, allowedOrigins, req)) {
      return createJsonResponse({ error: "Origin not allowed." }, 403, req);
    }
    return new Response(null, { headers: createCorsHeaders(origin) });
  }

  if (!origin || allowedOrigins.length === 0) {
    return null;
  }

  if (!isAllowedOrigin(origin, allowedOrigins, req)) {
    return createJsonResponse({ error: "Origin not allowed." }, 403, req);
  }

  return null;
}

export function getRequestId(req: Request): string {
  const existing = req.headers.get("x-request-id");
  return existing && existing.trim() ? existing.trim() : crypto.randomUUID();
}

export function getServiceSupabaseClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios.");
  }

  return createClient(supabaseUrl, supabaseServiceKey);
}

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  const normalized = token.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function requireAuthUser(req: Request, supabase = getServiceSupabaseClient()): Promise<AuthenticatedUser> {
  const token = extractBearerToken(req);
  if (!token) {
    throw new Error("Missing authorization token.");
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    throw new Error("Invalid or expired token.");
  }

  return {
    id: data.user.id,
    email: data.user.email,
  };
}

async function rateLimitWithUpstash(
  key: string,
  windowSec: number,
  maxReq: number,
): Promise<{ allowed: boolean; remaining: number; resetAtEpochMs: number }> {
  const url = Deno.env.get("UPSTASH_REDIS_REST_URL");
  const token = Deno.env.get("UPSTASH_REDIS_REST_TOKEN");
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

export async function rateLimitByUser(
  userId: string,
  functionName: string,
): Promise<{ allowed: boolean; remaining: number; resetAtEpochMs: number }> {
  const windowSec = Number(Deno.env.get("RATE_LIMIT_WINDOW_SEC") || "60");
  const maxReq = Number(Deno.env.get("RATE_LIMIT_MAX_REQ") || "60");
  const safeWindow = Number.isFinite(windowSec) && windowSec > 0 ? Math.round(windowSec) : 60;
  const safeMax = Number.isFinite(maxReq) && maxReq > 0 ? Math.round(maxReq) : 60;
  return rateLimitWithUpstash(`${functionName}:${userId}`, safeWindow, safeMax);
}

export async function parseAndValidateBody<T>(
  req: Request,
  schema: z.ZodSchema<T>,
): Promise<T> {
  const raw = await req.json();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Payload invalido: ${parsed.error.errors.map((e) => e.message).join("; ")}`);
  }
  return parsed.data;
}

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IPV4_RANGES.some((regex) => regex.test(ip));
}

function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

export function assertOutboundUrlAllowed(rawUrl: string, allowlist: string[]): URL {
  const parsed = new URL(rawUrl);
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("A URL de destino deve usar HTTP/HTTPS.");
  }

  const hostname = parsed.hostname.toLowerCase();
  const host = parsed.host.toLowerCase();
  const origin = parsed.origin.toLowerCase();
  const normalizedAllowlist = allowlist
    .flatMap((entry) => normalizeAllowlistEntry(entry))
    .filter(Boolean);
  const allowed = normalizedAllowlist.some((entry) => {
    return entry === hostname || entry === host || entry === origin;
  });

  if (!allowed) {
    throw new Error("Host de destino nao permitido pelo allowlist.");
  }

  if (isIpLiteral(hostname) && isPrivateIp(hostname)) {
    throw new Error("Endereco IP privado/loopback nao permitido.");
  }

  return parsed;
}

function normalizeAllowlistEntry(entry: string): string[] {
  const trimmed = entry.trim().toLowerCase();
  if (!trimmed) {
    return [];
  }

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

export { z };
