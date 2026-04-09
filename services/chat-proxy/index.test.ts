import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  detectUserIntent,
  generateSqlQueryWithRetry,
  invokeDelphiProxy,
  QUERY_GENERATOR_USER_FRIENDLY_ERROR,
  shouldGenerateChartResponse,
} from "./index.ts";
import { generateSqlQuery } from "./queryGenerator.ts";

Deno.test("invokeDelphiProxy forwards the user authorization token and internal proxy key", async () => {
  const originalFetch = globalThis.fetch;
  let capturedRequest: { url: string; init?: RequestInit } | null = null;

  (globalThis as any).fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capturedRequest = {
      url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      init,
    };

    return new Response(JSON.stringify({ success: true, data: [], rowCount: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await invokeDelphiProxy(
      "https://proxy.example.com/external-db-proxy",
      "service-role-key",
      "user-access-token",
      "internal-proxy-secret",
      {
        fields: "id",
        tables: "public.tabela",
        cond: "1=1",
      },
    );

    assertEquals(result.success, true);
    assert(capturedRequest !== null);
    const captured = capturedRequest as { url: string; init?: RequestInit };
    assertEquals(captured.url, "https://proxy.example.com/external-db-proxy");
    const headers = new Headers(captured.init?.headers);
    assertEquals(headers.get("Authorization"), "Bearer user-access-token");
    assertEquals(headers.get("x-internal-proxy-key"), "internal-proxy-secret");
    assertEquals(headers.get("apikey"), "service-role-key");
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

Deno.test("invokeDelphiProxy surfaces upstream 401 errors without masking them", async () => {
  const originalFetch = globalThis.fetch;

  (globalThis as any).fetch = async () =>
    new Response(JSON.stringify({ error: "Missing authorization header" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });

  try {
    await assertRejects(
      () =>
        invokeDelphiProxy(
          "https://proxy.example.com/external-db-proxy",
          "service-role-key",
          "user-access-token",
          "internal-proxy-secret",
          {
            fields: "id",
            tables: "public.tabela",
            cond: "1=1",
          },
        ),
      Error,
      "Missing authorization header",
    );
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

Deno.test("detectUserIntent does not classify ambiguous 'linha de produto' as chart", () => {
  const intent = detectUserIntent("Quero linha de produto com maior venda neste mes");
  assertNotEquals(intent, "chart");
});

Deno.test("chart rendering gate requires explicit chart request", () => {
  const implicitIntent = detectUserIntent("Quero linha de produto com maior venda no trimestre");
  const explicitIntent = detectUserIntent("Quero um grafico de vendas por produto");

  assertEquals(shouldGenerateChartResponse(implicitIntent), false);
  assertEquals(shouldGenerateChartResponse(explicitIntent), true);
});

Deno.test("friendly query generator message is non-technical", () => {
  assertStringIncludes(QUERY_GENERATOR_USER_FRIENDLY_ERROR, "Nao consegui montar a consulta");
  assert(!/\b(SWARM_|stack|trace|exception|error)\b/i.test(QUERY_GENERATOR_USER_FRIENDLY_ERROR));
});

Deno.test("generateSqlQueryWithRetry retries once and logs structured failure details", async () => {
  const originalWarn = console.warn;
  const originalError = console.error;
  const warnCalls: unknown[][] = [];
  const errorCalls: unknown[][] = [];

  console.warn = (...args: unknown[]) => warnCalls.push(args);
  console.error = (...args: unknown[]) => errorCalls.push(args);

  try {
    let invocationCount = 0;

    const result = await generateSqlQueryWithRetry({
      userMessage: "teste",
      activeSchemas: "Tabela: TESTE",
      requestId: "req-123",
      maxRetries: 1,
      queryFn: async () => {
        invocationCount += 1;
        return {
          error: "Falha interna ao montar consulta SQL Server.",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          shouldFallback: true,
          failureCode: "provider_http_error",
          failureHttpStatus: 503,
          retriable: true,
          failureDetail:
            "upstream timeout from provider while generating payload with extra details for diagnostics",
        };
      },
    });

    assertEquals(invocationCount, 2);
    assertEquals(result.attempts, 2);
    assertEquals(result.queryPayload.shouldFallback, true);
    assertEquals(warnCalls.length, 1);
    assertEquals(errorCalls.length, 1);

    assertEquals(warnCalls[0][0], "[chat][swarm][query_generator_failed_retrying]");
    const warnPayload = warnCalls[0][1] as Record<string, unknown>;
    assertEquals(warnPayload.request_id, "req-123");
    assertEquals(warnPayload.reason_code, "provider_http_error");
    assertEquals(warnPayload.http_status, 503);
    assert(typeof warnPayload.provider_error_snippet === "string");
    assert((warnPayload.provider_error_snippet as string).length <= 223);

    assertEquals(errorCalls[0][0], "[chat][swarm][query_generator_failed_final]");
    const errorPayload = errorCalls[0][1] as Record<string, unknown>;
    assertEquals(errorPayload.attempt, 2);
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
});

Deno.test("generateSqlQueryWithRetry returns successful payload from second attempt", async () => {
  let invocationCount = 0;

  const result = await generateSqlQueryWithRetry({
    userMessage: "teste",
    activeSchemas: "Tabela: TESTE",
    requestId: "req-456",
    maxRetries: 1,
    queryFn: async () => {
      invocationCount += 1;
      if (invocationCount === 1) {
        return {
          error: "Falha interna ao montar consulta SQL Server.",
          usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
          shouldFallback: true,
          failureCode: "network_error",
          retriable: true,
          failureDetail: "network timeout",
        };
      }

      return {
        fields: "SUM(valor) AS total_vendido",
        tables: "ATENDIMENTO",
        cond: "ATENDIMENTO.ATEN_ID_DEL IS NULL",
        order: "total_vendido",
        usage: { inputTokens: 7, outputTokens: 2, totalTokens: 9 },
        shouldFallback: false,
      };
    },
  });

  assertEquals(invocationCount, 2);
  assertEquals(result.attempts, 2);
  assertEquals(result.queryPayload.shouldFallback, false);
  assertEquals(result.queryPayload.fields, "SUM(valor) AS total_vendido");
  assertEquals(result.usage.totalTokens, 15);
});

Deno.test("generateSqlQuery accepts structured fields and joins arrays from provider payload", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvGet = Deno.env.get;
  (Deno.env as unknown as { get: typeof Deno.env.get }).get = (key: string) =>
    key === "GEMINI_API_KEY"
      ? "test-key"
      : key === "APP_TIMEZONE"
      ? "America/Sao_Paulo"
      : originalEnvGet.call(Deno.env, key);

  (globalThis as any).fetch = async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    fields: [
                      "CLIENTE_COMPRADOR.CLIE_NOMEPRINC AS nome_cliente",
                      "SUM(ATENDIMENTO.ATEN_VLTOTALLIQUIDO) AS faturamento_total",
                    ],
                    tables: ["ATENDIMENTO"],
                    joins: [
                      "LEFT JOIN CLIENTE AS CLIENTE_COMPRADOR ON CLIENTE_COMPRADOR.CLIE_ID = ATENDIMENTO.CLIE_ID_CLIENTE",
                    ],
                    cond:
                      "ATENDIMENTO.EMP_ID = 1 AND ATENDIMENTO.ATEN_ID_DEL IS NULL AND ATENDIMENTO.ATEN_STTIPO = 'V' GROUP BY CLIENTE_COMPRADOR.CLIE_NOMEPRINC",
                    order: "faturamento_total DESC",
                    rowspPage: 10,
                  }),
                },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );

  try {
    const result = await generateSqlQuery({
      userMessage: "top 10 clientes por faturamento",
      activeSchemas: "Tabela: ATENDIMENTO\nTabela: CLIENTE",
    });

    assertEquals(result.shouldFallback, false);
    assertEquals(
      result.fields,
      "CLIENTE_COMPRADOR.CLIE_NOMEPRINC AS nome_cliente, SUM(ATENDIMENTO.ATEN_VLTOTALLIQUIDO) AS faturamento_total",
    );
    assertEquals(
      result.tables,
      "ATENDIMENTO LEFT JOIN CLIENTE AS CLIENTE_COMPRADOR ON CLIENTE_COMPRADOR.CLIE_ID = ATENDIMENTO.CLIE_ID_CLIENTE",
    );
    assertEquals(result.order, "faturamento_total DESC");
    assertEquals(result.rowspPage, 10);
  } finally {
    (globalThis as any).fetch = originalFetch;
    (Deno.env as unknown as { get: typeof Deno.env.get }).get = originalEnvGet;
  }
});

Deno.test("generateSqlQuery prompt separates atendimento summary from financeiro parcel analysis", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvGet = Deno.env.get;
  let capturedBody: any = null;

  (Deno.env as unknown as { get: typeof Deno.env.get }).get = (key: string) =>
    key === "GEMINI_API_KEY"
      ? "test-key"
      : key === "APP_TIMEZONE"
      ? "America/Sao_Paulo"
      : originalEnvGet.call(Deno.env, key);

  (globalThis as any).fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    capturedBody = init?.body ? JSON.parse(String(init.body)) : null;

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    fields: "COALESCE(SUM(FINANCEIRO.FIN_VLBAIXA), 0) AS total_recebido",
                    tables: "FINANCEIRO",
                    cond: "FINANCEIRO.FIN_ID_DEL IS NULL",
                    order: "total_recebido DESC",
                  }),
                },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  try {
    const result = await generateSqlQuery({
      userMessage: "quero contas a receber em aberto por cliente",
      activeSchemas: "Tabela: ATENDIMENTO\nTabela: FINANCEIRO",
    });

    assertEquals(result.shouldFallback, false);
    const prompt = capturedBody?.system_instruction?.parts?.[0]?.text ?? "";
    assertStringIncludes(prompt, "Quando o schema ativo incluir FINANCEIRO");
    assertStringIncludes(prompt, "Nao use ATEN_STFINANCEIRO para responder perguntas em nivel de parcela ou titulo quando o schema ativo incluir FINANCEIRO");
  } finally {
    (globalThis as any).fetch = originalFetch;
    (Deno.env as unknown as { get: typeof Deno.env.get }).get = originalEnvGet;
  }
});

Deno.test("generateSqlQuery prompt includes estoque heuristics when inventory schema is active", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvGet = Deno.env.get;
  let capturedBody: any = null;

  (Deno.env as unknown as { get: typeof Deno.env.get }).get = (key: string) =>
    key === "GEMINI_API_KEY"
      ? "test-key"
      : key === "APP_TIMEZONE"
      ? "America/Sao_Paulo"
      : originalEnvGet.call(Deno.env, key);

  (globalThis as any).fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    capturedBody = init?.body ? JSON.parse(String(init.body)) : null;

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    fields: "PRODUTO_ESTOQUE.PRODE_SALDO",
                    tables: "PRODUTO_ESTOQUE",
                    cond: "PRODUTO_ESTOQUE.PRODE_ID_DEL IS NULL",
                    order: "PRODUTO_ESTOQUE.PRODE_SALDO DESC",
                  }),
                },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  try {
    const result = await generateSqlQuery({
      userMessage: "quais produtos estao em ruptura de estoque",
      activeSchemas: "Tabela: PRODUTO_ESTOQUE\nTabela: ESTOQUE_HISTORICO\nTabela: PRODUTO_ESTOQUECLASSIFICACAO",
    });

    assertEquals(result.shouldFallback, false);
    const prompt = capturedBody?.system_instruction?.parts?.[0]?.text ?? "";
    assertStringIncludes(prompt, "priorize PRODUTO_ESTOQUE");
    assertStringIncludes(prompt, "use PRODE_SALDO * PRODE_CTMEDIO para capital investido");
    assertStringIncludes(prompt, "Para ruptura, compare PRODE_SALDO com PRODE_SALDOMIN");
  } finally {
    (globalThis as any).fetch = originalFetch;
    (Deno.env as unknown as { get: typeof Deno.env.get }).get = originalEnvGet;
  }
});
