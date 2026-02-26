import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// List of forbidden keywords for security
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

function validateQuery(query: string): { valid: boolean; error?: string } {
  const upperQuery = query.toUpperCase().trim();
  
  // Check for forbidden keywords
  for (const keyword of FORBIDDEN_KEYWORDS) {
    // Match keyword as whole word (not part of another word)
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(upperQuery)) {
      return { 
        valid: false, 
        error: `Operação "${keyword}" não é permitida. Apenas SELECT e CREATE VIEW são permitidos.` 
      };
    }
  }

  // Must start with SELECT or CREATE VIEW
  const isSelect = upperQuery.startsWith("SELECT");
  const isCreateView = upperQuery.startsWith("CREATE VIEW") || upperQuery.startsWith("CREATE OR REPLACE VIEW");

  if (!isSelect && !isCreateView) {
    return { 
      valid: false, 
      error: "A query deve começar com SELECT ou CREATE VIEW." 
    };
  }

  return { valid: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query } = await req.json();

    if (!query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ error: "Query é obrigatória" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate query
    const validation = validateQuery(query);
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Execute the query using the database function
    const { data, error } = await supabase.rpc("execute_safe_query", { 
      query_text: query 
    });

    if (error) {
      return new Response(
        JSON.stringify({ error: `Erro na execução: ${error.message}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        data,
        rowCount: Array.isArray(data) ? data.length : 0
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Execute query error:", error);
    const errorMessage = error instanceof Error ? error.message : "Erro ao executar query";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
