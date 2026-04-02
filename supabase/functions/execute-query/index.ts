import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  createJsonResponse,
  enforceCors,
  getRequestId,
  getServiceSupabaseClient,
  parseAndValidateBody,
  rateLimitByUser,
  requireAuthUser,
  z,
} from "../_shared/security.ts";

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
];

const querySchema = z.object({
  query: z.string().min(1, "Query obrigatoria."),
});

function validateQuery(query: string): { valid: boolean; error?: string } {
  const upperQuery = query.toUpperCase().trim();

  for (const keyword of FORBIDDEN_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(upperQuery)) {
      return {
        valid: false,
        error: `Operacao "${keyword}" nao permitida. Apenas SELECT e CREATE VIEW sao permitidos.`,
      };
    }
  }

  const isSelect = upperQuery.startsWith("SELECT");
  const isCreateView = upperQuery.startsWith("CREATE VIEW") || upperQuery.startsWith("CREATE OR REPLACE VIEW");
  if (!isSelect && !isCreateView) {
    return { valid: false, error: "A query deve comecar com SELECT ou CREATE VIEW." };
  }

  return { valid: true };
}

serve(async (req) => {
  const corsResponse = enforceCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return createJsonResponse({ error: "Metodo nao permitido. Use POST." }, 405, req);
  }

  const requestId = getRequestId(req);

  try {
    // service_role is only valid inside trusted server runtime (Edge Function).
    const supabase = getServiceSupabaseClient();
    const user = await requireAuthUser(req, supabase);
    const rateLimit = await rateLimitByUser(user.id, "execute-query");

    if (!rateLimit.allowed) {
      return createJsonResponse(
        { error: "Rate limit excedido.", request_id: requestId, reset_at: rateLimit.resetAtEpochMs },
        429,
        req,
      );
    }

    const body = await parseAndValidateBody(req, querySchema);
    const validation = validateQuery(body.query);
    if (!validation.valid) {
      return createJsonResponse({ error: validation.error, request_id: requestId }, 400, req);
    }

    const { data, error } = await supabase.rpc("execute_safe_query", { query_text: body.query });
    if (error) {
      return createJsonResponse({ error: `Erro na execucao: ${error.message}`, request_id: requestId }, 400, req);
    }

    return createJsonResponse(
      {
        success: true,
        data,
        rowCount: Array.isArray(data) ? data.length : 0,
        request_id: requestId,
      },
      200,
      req,
      { "x-request-id": requestId },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao executar query";
    return createJsonResponse({ error: message, request_id: requestId }, 500, req, { "x-request-id": requestId });
  }
});
