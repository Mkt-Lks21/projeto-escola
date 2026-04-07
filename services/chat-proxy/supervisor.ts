export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface SupervisorInput {
  userMessage: string;
  chatHistory?: Array<{ role?: string; content?: string }>;
}

export type WorkerName =
  | "MarketingAgent"
  | "FinanceiroAgent"
  | "CaixaBancosAgent"
  | "ProdutosAgent"
  | "EstoqueAgent";

export interface SupervisorDecision {
  reasoning: string;
  selectedWorkers: WorkerName[];
  confidenceScore: number;
}

export interface SupervisorResult extends SupervisorDecision {
  usage: TokenUsage;
  shouldFallback: boolean;
}

function env(name: string, fallback = ""): string {
  const processValue = typeof process !== "undefined" ? process.env?.[name] : undefined;
  if (typeof processValue === "string" && processValue.trim()) {
    return processValue.trim();
  }

  const denoRuntime = globalThis as typeof globalThis & {
    Deno?: {
      env?: {
        get(name: string): string | undefined;
      };
    };
  };
  const denoValue = typeof denoRuntime.Deno?.env?.get === "function" ? denoRuntime.Deno.env.get(name) : undefined;
  return typeof denoValue === "string" && denoValue.trim() ? denoValue.trim() : fallback;
}

const VALID_WORKERS = new Set<WorkerName>([
  "MarketingAgent",
  "FinanceiroAgent",
  "CaixaBancosAgent",
  "ProdutosAgent",
  "EstoqueAgent",
]);

const WORKER_PRIORITY: WorkerName[] = [
  "MarketingAgent",
  "FinanceiroAgent",
  "CaixaBancosAgent",
  "ProdutosAgent",
  "EstoqueAgent",
];

const SUPERVISOR_PROMPT = `Voce e o Agente Supervisor de dados de um ERP/CRM.
Sua funcao e ler a solicitacao do usuario e decidir quais agentes especialistas devem participar da resposta.

DOMINIOS E TABELAS:
1) MarketingAgent: CLIENTE, CLIENTE_TIPOVINCULO, CLIENTE_END, ATENDIMENTO, PROSPECCAO.
2) FinanceiroAgent: FINANCEIRO_MOTIVO, FINANCEIRO_HISTORICO, FINANCEIRO_TRANSFERENCIACONTA, RECEBIMENTO_TIPO, RECEBIMENTO_TIPO_EMPRESA, CONTA.
3) CaixaBancosAgent: CAIXA_IDENTIFICACAO, CAIXA_FLUXO, BANCO.
4) ProdutosAgent: PRODUTO, PRODUTO_GRUPO, PRODUTO_TIPOITEM, PRODUTO_TABVALOR_ITEM.
5) EstoqueAgent: PRODUTO_ESTOQUE, PRODUTO_ESTOQUECLASSIFICACAO, ESTOQUE_HISTORICO.

REGRAS:
- Se a pergunta envolver um unico dominio, retorne apenas um worker.
- Se envolver cruzamento de dominios, retorne todos os workers necessarios.
- Se for bate-papo sem necessidade de dados estruturados, retorne selectedWorkers vazio [].
- Nao invente workers fora da lista.
- Sinais de vendas (venda, vendido, vendeu, vendedor, faturamento, faturado, pedidos, atendimento) devem incluir MarketingAgent (ATENDIMENTO).
- Sinais financeiros (pagamento, recebimento, financeiro, parcelas, titulos) devem incluir FinanceiroAgent.
- Para perguntas de faturamento por periodo (ex: "quanto foi vendido em outubro de 2025"), priorize MarketingAgent e FinanceiroAgent juntos.
- Produtos/itens/grupos => ProdutosAgent. Estoque/movimentacao => EstoqueAgent. Caixa/banco => CaixaBancosAgent.

Retorne APENAS JSON valido no formato:
{
  "reasoning": "justificativa curta citando dominios/tabelas",
  "selectedWorkers": ["MarketingAgent"],
  "confidenceScore": 0.95
}`;

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function toSafeTokenCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function extractGeminiUsage(rawUsage: any): TokenUsage {
  const input = toSafeTokenCount(rawUsage?.promptTokenCount ?? rawUsage?.inputTokenCount);
  const output = toSafeTokenCount(rawUsage?.candidatesTokenCount ?? rawUsage?.outputTokenCount);
  const total = toSafeTokenCount(rawUsage?.totalTokenCount) || input + output;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}

function parseResponseText(rawData: any): string {
  const parts = rawData?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";

  const textParts = parts
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .filter((part: string) => part.trim().length > 0);

  return textParts.join("\n").trim();
}

function normalizeIntentText(text: string): string {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeWorkers(value: unknown): WorkerName[] {
  if (!Array.isArray(value)) return [];

  const normalized = new Set<WorkerName>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    if (VALID_WORKERS.has(item as WorkerName)) {
      normalized.add(item as WorkerName);
    }
  }

  return Array.from(normalized);
}

function inferWorkersFromKeywords(userMessage: string): { workers: WorkerName[]; reasons: string[] } {
  const normalized = normalizeIntentText(userMessage);
  if (!normalized) {
    return { workers: [], reasons: [] };
  }

  const selected = new Set<WorkerName>();
  const reasons: string[] = [];

  if (
    /\b(venda|vendas|vendido|vendida|vendeu|vendedor|vendedores|faturamento|faturado|faturou|pedido|pedidos|atendimento|ticket|receita)\b/.test(
      normalized,
    )
  ) {
    selected.add("MarketingAgent");
    reasons.push("sales_signal");
  }

  if (
    /\b(financeiro|pagamento|pagamentos|recebimento|receber|titulo|titulos|parcela|parcelas|liquido|juros|multa|conta)\b/.test(
      normalized,
    )
  ) {
    selected.add("FinanceiroAgent");
    reasons.push("financial_signal");
  }

  if (/\b(caixa|banco|fluxo|tesouraria)\b/.test(normalized)) {
    selected.add("CaixaBancosAgent");
    reasons.push("cash_bank_signal");
  }

  if (/\b(produto|produtos|item|itens|categoria|grupo|grupos)\b/.test(normalized)) {
    selected.add("ProdutosAgent");
    reasons.push("product_signal");
  }

  if (/\b(estoque|inventario|movimentacao|movimento|entrada|saida)\b/.test(normalized)) {
    selected.add("EstoqueAgent");
    reasons.push("inventory_signal");
  }

  if (/\b(cliente|clientes|crm|lead|prospeccao)\b/.test(normalized)) {
    selected.add("MarketingAgent");
    reasons.push("crm_signal");
  }

  return {
    workers: WORKER_PRIORITY.filter((worker) => selected.has(worker)),
    reasons: Array.from(new Set(reasons)),
  };
}

function mergeWorkers(base: WorkerName[], extra: WorkerName[]): WorkerName[] {
  const merged = new Set<WorkerName>();
  for (const worker of base) {
    merged.add(worker);
  }
  for (const worker of extra) {
    merged.add(worker);
  }
  return WORKER_PRIORITY.filter((worker) => merged.has(worker));
}

function clampConfidence(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

function buildUserInput(userMessage: string, chatHistory?: Array<{ role?: string; content?: string }>): string {
  const historyLines = (chatHistory || [])
    .slice(-8)
    .map((message) => {
      const role = typeof message?.role === "string" ? message.role : "user";
      const content = typeof message?.content === "string" ? message.content.trim() : "";
      return content ? `${role}: ${content}` : "";
    })
    .filter((line) => line.length > 0)
    .join("\n");

  if (!historyLines) {
    return `Pergunta atual:\n${userMessage}`;
  }

  return `Historico recente:\n${historyLines}\n\nPergunta atual:\n${userMessage}`;
}

export async function routeToSpecialist({ userMessage, chatHistory }: SupervisorInput): Promise<SupervisorResult> {
  const geminiApiKey = env("GEMINI_API_KEY");
  if (!geminiApiKey) {
    return {
      reasoning: "GEMINI_API_KEY nao configurada.",
      selectedWorkers: [],
      confidenceScore: 0,
      usage: emptyUsage(),
      shouldFallback: true,
    };
  }

  const sanitizedUserMessage = (userMessage || "").trim();
  if (!sanitizedUserMessage) {
    return {
      reasoning: "Mensagem vazia.",
      selectedWorkers: [],
      confidenceScore: 0,
      usage: emptyUsage(),
      shouldFallback: false,
    };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SUPERVISOR_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: buildUserInput(sanitizedUserMessage, chatHistory) }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    });

    const rawText = await response.text();
    const rawData = rawText ? JSON.parse(rawText) : {};
    const usage = extractGeminiUsage(rawData?.usageMetadata);

    if (!response.ok) {
      throw new Error(`Supervisor Gemini falhou com status ${response.status}.`);
    }

    const resultText = parseResponseText(rawData);
    if (!resultText) {
      throw new Error("Supervisor retornou payload vazio.");
    }

    const parsedDecision = JSON.parse(resultText);
    const selectedWorkers = normalizeWorkers(parsedDecision?.selectedWorkers);
    const keywordInference = inferWorkersFromKeywords(sanitizedUserMessage);
    const mergedWorkers = mergeWorkers(selectedWorkers, keywordInference.workers);

    if (keywordInference.workers.length > 0 && mergedWorkers.length !== selectedWorkers.length) {
      console.log("[supervisor][keyword_override]", {
        selected: selectedWorkers,
        keyword: keywordInference.workers,
        merged: mergedWorkers,
        reasons: keywordInference.reasons,
      });
    }

    return {
      reasoning: typeof parsedDecision?.reasoning === "string" ? parsedDecision.reasoning : "Sem justificativa.",
      selectedWorkers: mergedWorkers,
      confidenceScore: clampConfidence(parsedDecision?.confidenceScore),
      usage,
      shouldFallback: false,
    };
  } catch (error) {
    console.warn("Erro no Supervisor Swarm:", error);
    return {
      reasoning: "Falha no supervisor (rede/parsing).",
      selectedWorkers: [],
      confidenceScore: 0,
      usage: emptyUsage(),
      shouldFallback: true,
    };
  }
}
