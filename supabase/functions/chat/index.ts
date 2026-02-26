import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, conversationId, agentId } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get LLM settings
    const { data: settings, error: settingsError } = await supabase
      .from("llm_settings")
      .select("*")
      .eq("is_active", true)
      .single();

    if (settingsError || !settings) {
      return new Response(
        JSON.stringify({ error: "Configure suas credenciais de LLM na aba Admin primeiro." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ===== Agent logic =====
    let agentContext = null;
    if (agentId) {
      const { data: agent } = await supabase
        .from("agents")
        .select("*")
        .eq("id", agentId)
        .single();

      if (agent) {
        const { data: agentTables } = await supabase
          .from("agent_tables")
          .select("*")
          .eq("agent_id", agentId);

        agentContext = { agent, tables: agentTables || [] };
      }
    }

    const externalUrl = Deno.env.get("EXTERNAL_SUPABASE_URL");
    const externalKey = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_KEY");

    if (!externalUrl || !externalKey) {
      return new Response(
        JSON.stringify({ error: "Banco externo não configurado. Defina EXTERNAL_SUPABASE_URL e EXTERNAL_SUPABASE_SERVICE_KEY." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let metadataContext = "";
    try {
      const externalSupabase = createClient(externalUrl, externalKey);
      let { data: extData } = await externalSupabase.rpc("get_database_metadata");

      let filteredData = (extData || []).filter((row: any) => row.schema_name === "public");

      if (agentContext && agentContext.tables.length > 0) {
        const allowedTables = new Set(
          agentContext.tables.map((t: any) => {
            const schemaName = typeof t.schema_name === "string" && t.schema_name.startsWith("external.")
              ? t.schema_name.replace(/^external\./, "")
              : t.schema_name;
            return `${schemaName}.${t.table_name}`;
          })
        );

        filteredData = filteredData.filter((row: any) =>
          allowedTables.has(`${row.schema_name}.${row.table_name}`)
        );
      }

      if (filteredData.length > 0) {
        metadataContext = `\n\nEstrutura do banco de dados Supabase externo (schema public):\n${formatMetadata(filteredData)}`;
      }
    } catch (e) {
      console.log("Could not fetch external metadata:", e);
    }

    // ===== Build system prompt =====
    const targetDescription = "BANCO DE DADOS EXTERNO no Supabase (apenas schema public)";

    let behaviorPrompt: string;

    if (agentContext) {
      const tablesList = agentContext.tables
        .map((t: any) => {
          const schemaName = typeof t.schema_name === "string" && t.schema_name.startsWith("external.")
            ? t.schema_name.replace(/^external\./, "")
            : t.schema_name;
          return `${schemaName}.${t.table_name}`;
        })
        .filter((table: string) => table.startsWith("public."))
        .join(", ");

      if (agentContext.agent.system_prompt) {
        behaviorPrompt = agentContext.agent.system_prompt;
      } else {
        behaviorPrompt = `Você é ${agentContext.agent.name}, um assistente de inteligência de negócios especializado nas áreas: ${tablesList}.

Seu papel é atuar como um analista senior dedicado ao negócio do usuário.
Você deve:
- Responder com profundidade e contexto de negócio, não apenas dados brutos
- Ao apresentar resultados, sempre interpretar o que os números significam para o negócio (tendências, alertas, oportunidades)
- Sugerir proativamente análises complementares relevantes
- Usar linguagem profissional mas acessível
- Quando o usuário perguntar algo genérico, direcionar para as tabelas que você domina e oferecer opções de análise

Você só tem acesso às seguintes tabelas: ${tablesList}
Gere queries APENAS sobre essas tabelas.`;
      }
    } else {
      behaviorPrompt = `Você é um assistente especializado em análise de banco de dados PostgreSQL.
    
Suas capacidades:
- Criar queries SELECT de qualquer complexidade
- Usar CTEs (WITH ... AS), subqueries, window functions (ROW_NUMBER, RANK, NTILE, etc.)
- Funções de agregação complexas (SUM, COUNT, AVG, GROUP BY, HAVING)
- JOINs entre múltiplas tabelas
- Criar VIEWs para análises recorrentes
- Análises avançadas como Curva ABC, Pareto, rankings, médias móveis
- Sugerir otimizações e melhores práticas

CONTEXTO: O usuário está usando o ${targetDescription}.
RESTRIÇÃO: você só pode usar tabelas do schema public.`;
    }

    const technicalInstructions = `
LIBERDADE TOTAL PARA QUERIES DE LEITURA:
- Você tem liberdade total para criar qualquer query de leitura/análise
- Use CTEs, subqueries, window functions, CASE WHEN, e qualquer recurso do PostgreSQL
- NÃO há restrições de keywords - use qualquer construção SQL necessária para a análise
- A única limitação é que queries devem ser de LEITURA (não modifique dados)
- RESTRIÇÃO DE ESQUEMA: use somente tabelas do schema public
- IMPORTANTE: NUNCA coloque ponto e vírgula (;) no final das queries SQL. O sistema encapsula suas queries automaticamente e o ; causa erro de sintaxe.

COMPORTAMENTO OBRIGATÓRIO:
- SEMPRE que o usuário fizer uma pergunta sobre dados, você DEVE executar a query automaticamente
- Use SEMPRE a tag [AUTO_EXECUTE] antes de cada bloco SQL que deve ser executado
- O sistema irá executar automaticamente qualquer query marcada com [AUTO_EXECUTE]
- Após mostrar os resultados, explique brevemente o que os dados significam
- NÃO pergunte se o usuário quer executar - EXECUTE AUTOMATICAMENTE

Formato de resposta para queries:
1. Explique brevemente o que você vai buscar
2. Coloque [AUTO_EXECUTE] na linha antes do bloco de código SQL
3. O sistema executará e mostrará os resultados
4. Analise os resultados para o usuário

Exemplo:
"Vou buscar o lucro de 2023 para você.

[AUTO_EXECUTE]
\`\`\`sql
SELECT SUM(valor) as lucro_total FROM vendas WHERE YEAR(data) = 2023
\`\`\`
"`;

    const systemPrompt = `${behaviorPrompt}\n${technicalInstructions}\n${metadataContext}`;

    let response;
    
    if (settings.provider === "openai") {
      response = await callOpenAI(settings.api_key, settings.model, systemPrompt, messages);
    } else {
      response = await callGemini(settings.api_key, settings.model, systemPrompt, messages);
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Chat error:", error);
    const errorMessage = error instanceof Error ? error.message : "Erro interno do servidor";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function formatMetadata(metadata: any[]): string {
  const grouped: Record<string, Record<string, string[]>> = {};
  
  for (const row of metadata) {
    if (!grouped[row.schema_name]) {
      grouped[row.schema_name] = {};
    }
    if (!grouped[row.schema_name][row.table_name]) {
      grouped[row.schema_name][row.table_name] = [];
    }
    grouped[row.schema_name][row.table_name].push(
      `${row.column_name} (${row.data_type}${row.is_nullable ? ", nullable" : ""})`
    );
  }

  let result = "";
  for (const [schema, tables] of Object.entries(grouped)) {
    result += `\nSchema: ${schema}\n`;
    for (const [table, columns] of Object.entries(tables)) {
      result += `  Tabela: ${table}\n`;
      result += `    Colunas: ${columns.join(", ")}\n`;
    }
  }
  return result;
}

async function callOpenAI(apiKey: string, model: string, systemPrompt: string, messages: any[]) {
  return await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      stream: true,
    }),
  });
}

async function callGemini(apiKey: string, model: string, systemPrompt: string, messages: any[]) {
  const geminiModel = model.replace("gemini-", "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`;
  
  const contents = messages.map((msg: any) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
    }),
  });

  // Convert Gemini streaming format to OpenAI-compatible SSE
  const reader = response.body?.getReader();
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      if (!reader) {
        controller.close();
        return;
      }
      
      const decoder = new TextDecoder();
      let buffer = "";
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        // Parse JSON chunks from Gemini
        try {
          const lines = buffer.split("\n");
          for (const line of lines) {
            if (line.trim().startsWith("{") || line.trim().startsWith("[")) {
              try {
                const data = JSON.parse(line.trim().replace(/^\[|\]$/g, ""));
                if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
                  const text = data.candidates[0].content.parts[0].text;
                  const sseData = JSON.stringify({
                    choices: [{ delta: { content: text } }]
                  });
                  controller.enqueue(encoder.encode(`data: ${sseData}\n\n`));
                }
              } catch {}
            }
          }
          buffer = lines[lines.length - 1];
        } catch {}
      }
      
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream);
}
