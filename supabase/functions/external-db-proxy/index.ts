import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  assertOutboundUrlAllowed,
  createJsonResponse,
  enforceCors,
  getRequestId,
  getServiceSupabaseClient,
  parseAndValidateBody,
  rateLimitByUser,
  z,
} from "../_shared/security.ts";

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

  try {
    const supabase = getServiceSupabaseClient();
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
    const delphiAuthBearer = Deno.env.get("DELPHI_AUTH_BEARER")?.trim();
    const allowedProxyHosts = (Deno.env.get("ALLOWED_PROXY_HOSTS") || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (!delphiApiUrl || !delphiApiToken ) {
      return createPayloadResponse(
        {
          success: false,
          data: [],
          rowCount: 0,
          error: "Segredos DELPHI_API_URL, DELPHI_API_TOKEN e DELPHI_AUTH_BEARER sao obrigatorios.",
        },
        500,
        req,
        requestId,
      );
    }

    const validatedUrl = assertOutboundUrlAllowed(delphiApiUrl, allowedProxyHosts);
    const body = await parseAndValidateBody(req, proxyRequestSchema);

    const order = toStringWithFallback(body.order, "");
    const pageNumber = toStringWithFallback(body.pageNumber, "1");
    const rowspPage = toStringWithFallback(body.rowspPage, "15");
    const empresa = toStringWithFallback(body.empresa, "1");

    const params = new FormData();
    params.append("function", "1");
    params.append("TokenAPI", delphiApiToken);
    params.append("fields", body.fields.trim());
    params.append("tables", body.tables.trim());
    params.append("cond", body.cond.trim());
    params.append("order", order);
    params.append("pagenumber", pageNumber);
    params.append("RowspPage", rowspPage);
    params.append("empresa", empresa);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("upstream timeout"), 12000);

    const curlCommand = `curl -k -X POST '${validatedUrl.href}' \\
  -H 'Authorization: Bearer ${delphiAuthBearer}' \\
  -F 'function=1' \\
  -F 'TokenAPI=${delphiApiToken}' \\
  -F 'fields=${body.fields.trim()}' \\
  -F 'tables=${body.tables.trim()}' \\
  -F 'cond=${body.cond.trim()}' \\
  -F 'order=${order}' \\
  -F 'pagenumber=${pageNumber}' \\
  -F 'RowspPage=${rowspPage}' \\
  -F 'empresa=${empresa}'`;
    console.log("[DELPHI CURL COMMAND]\n" + curlCommand);

    const headers: Record<string, string> = {};
    if (delphiAuthBearer && delphiAuthBearer.trim() !== "") {
      headers["Authorization"] = `Bearer ${delphiAuthBearer}`;
    }

    const delphiResponse = await fetch(validatedUrl, {
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
    if (body.debug === true) {
      return createJsonResponse(
        { _debug: true, _status: delphiResponse.status, _raw: rawBody, request_id: requestId },
        200,
        req,
      );
    }

    let parsedBody: Record<string, unknown> | null = null;
    try {
      const candidate = rawBody ? JSON.parse(rawBody) : null;
      parsedBody = candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? (candidate as Record<string, unknown>)
        : null;
    } catch {
      parsedBody = null;
    }

    if (!delphiResponse.ok) {
      return createPayloadResponse(
        {
          success: false,
          data: [],
          rowCount: 0,
          error: typeof parsedBody?.error === "string" ? parsedBody.error : rawBody || `Erro upstream (${delphiResponse.status}).`,
        },
        502,
        req,
        requestId,
      );
    }

    const resultNode = Array.isArray(parsedBody?.RESULT) ? parsedBody.RESULT[0] : null;
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

    return createPayloadResponse(responsePayload, 200, req, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno no proxy Delphi.";
    return createPayloadResponse({ success: false, data: [], rowCount: 0, error: message }, 500, req, requestId);
  }
}

if (import.meta.main) {
  serve(handleExternalDbProxyRequest);
}
