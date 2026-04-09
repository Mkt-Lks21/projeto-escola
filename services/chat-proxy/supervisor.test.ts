import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { routeToSpecialist } from "./supervisor.ts";

Deno.test("routeToSpecialist prompt reflects updated financeiro domain tables", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvGet = Deno.env.get;
  let capturedBody: any = null;

  (Deno.env as unknown as { get: typeof Deno.env.get }).get = (key: string) =>
    key === "GEMINI_API_KEY" ? "test-key" : originalEnvGet.call(Deno.env, key);

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
                    reasoning: "ok",
                    selectedWorkers: [],
                    confidenceScore: 0.9,
                  }),
                },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  try {
    const result = await routeToSpecialist({ userMessage: "teste supervisor" });
    assertEquals(result.shouldFallback, false);
    const prompt = capturedBody?.system_instruction?.parts?.[0]?.text ?? "";
    assertStringIncludes(prompt, "FinanceiroAgent: FINANCEIRO, FINANCEIRO_MOTIVO, FINANCEIRO_TRANSFERENCIACONTA");
    assertStringIncludes(prompt, "FRANQUIA_FECHAMENTO");
    assert(!prompt.includes("FINANCEIRO_HISTORICO"));
  } finally {
    (globalThis as any).fetch = originalFetch;
    (Deno.env as unknown as { get: typeof Deno.env.get }).get = originalEnvGet;
  }
});

Deno.test("routeToSpecialist prioritizes EstoqueAgent for ruptura e subestoque sem puxar ProdutosAgent", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvGet = Deno.env.get;

  (Deno.env as unknown as { get: typeof Deno.env.get }).get = (key: string) =>
    key === "GEMINI_API_KEY" ? "test-key" : originalEnvGet.call(Deno.env, key);

  (globalThis as any).fetch = async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    reasoning: "ok",
                    selectedWorkers: [],
                    confidenceScore: 0.9,
                  }),
                },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );

  try {
    const result = await routeToSpecialist({
      userMessage: "quais produtos estao em ruptura de estoque por subestoque",
    });

    assert(result.selectedWorkers.includes("EstoqueAgent"));
    assert(!result.selectedWorkers.includes("ProdutosAgent"));
  } finally {
    (globalThis as any).fetch = originalFetch;
    (Deno.env as unknown as { get: typeof Deno.env.get }).get = originalEnvGet;
  }
});

Deno.test("routeToSpecialist routes receita de franquias to FinanceiroAgent sem forcar ComercialAgent", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvGet = Deno.env.get;

  (Deno.env as unknown as { get: typeof Deno.env.get }).get = (key: string) =>
    key === "GEMINI_API_KEY" ? "test-key" : originalEnvGet.call(Deno.env, key);

  (globalThis as any).fetch = async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    reasoning: "ok",
                    selectedWorkers: [],
                    confidenceScore: 0.9,
                  }),
                },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );

  try {
    const result = await routeToSpecialist({
      userMessage: "qual a receita de franquias por periodo",
    });

    assert(result.selectedWorkers.includes("FinanceiroAgent"));
    assert(!result.selectedWorkers.includes("ComercialAgent"));
  } finally {
    (globalThis as any).fetch = originalFetch;
    (Deno.env as unknown as { get: typeof Deno.env.get }).get = originalEnvGet;
  }
});
