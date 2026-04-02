import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  createJsonResponse,
  enforceCors,
  getRequestId,
  getServiceSupabaseClient,
  rateLimitByUser,
  requireAuthUser,
} from "../_shared/security.ts";

serve(async (req) => {
  const corsResponse = enforceCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return createJsonResponse({ error: "Metodo nao permitido. Use POST." }, 405, req);
  }

  const requestId = getRequestId(req);

  try {
    const supabase = getServiceSupabaseClient();
    const user = await requireAuthUser(req, supabase);
    const rateLimit = await rateLimitByUser(user.id, "fetch-metadata");

    if (!rateLimit.allowed) {
      return createJsonResponse(
        { error: "Rate limit excedido.", request_id: requestId, reset_at: rateLimit.resetAtEpochMs },
        429,
        req,
      );
    }

    const { data: columns, error } = await supabase.rpc("get_database_metadata");
    if (error) {
      return createJsonResponse(
        {
          error: "Funcao de metadados nao encontrada. Execute a migracao primeiro.",
          columns: [],
          request_id: requestId,
        },
        400,
        req,
      );
    }

    await supabase
      .from("database_metadata_cache")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (columns && columns.length > 0) {
      const cacheData = columns.map((col: Record<string, unknown>) => ({
        schema_name: col.schema_name,
        table_name: col.table_name,
        column_name: col.column_name,
        data_type: col.data_type,
        is_nullable: col.is_nullable,
        column_default: col.column_default,
      }));
      await supabase.from("database_metadata_cache").insert(cacheData);
    }

    return createJsonResponse(
      {
        success: true,
        count: columns?.length || 0,
        message: `Cache atualizado com ${columns?.length || 0} colunas`,
        request_id: requestId,
      },
      200,
      req,
      { "x-request-id": requestId },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao buscar metadados";
    return createJsonResponse({ error: message, request_id: requestId }, 500, req, { "x-request-id": requestId });
  }
});
