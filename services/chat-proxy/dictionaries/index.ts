import { COMERCIAL_SCHEMA } from "./comercial.ts";
import { FINANCEIRO_SCHEMA } from "./financeiro.ts";
import { CAIXABANCOS_SCHEMA } from "./caixa_bancos.ts";
import { PRODUTOS_SCHEMA } from "./produtos.ts";
import { ESTOQUE_SCHEMA } from "./estoque.ts";

export * from "./comercial.ts";
export * from "./financeiro.ts";
export * from "./caixa_bancos.ts";
export * from "./produtos.ts";
export * from "./estoque.ts";

export type WorkerName =
  | "ComercialAgent"
  | "FinanceiroAgent"
  | "CaixaBancosAgent"
  | "ProdutosAgent"
  | "EstoqueAgent";

const WORKER_SCHEMAS: Record<WorkerName, string> = {
  ComercialAgent: COMERCIAL_SCHEMA,
  FinanceiroAgent: FINANCEIRO_SCHEMA,
  CaixaBancosAgent: CAIXABANCOS_SCHEMA,
  ProdutosAgent: PRODUTOS_SCHEMA,
  EstoqueAgent: ESTOQUE_SCHEMA,
};

const WORKER_ORDER: WorkerName[] = [
  "ComercialAgent",
  "FinanceiroAgent",
  "CaixaBancosAgent",
  "ProdutosAgent",
  "EstoqueAgent",
];

export function resolveSchemas(workers: readonly string[]): string {
  const selected = new Set<WorkerName>();

  for (const worker of workers) {
    if (worker in WORKER_SCHEMAS) {
      selected.add(worker as WorkerName);
    }
  }

  return WORKER_ORDER
    .filter((worker) => selected.has(worker))
    .map((worker) => WORKER_SCHEMAS[worker])
    .join("\n\n---\n\n");
}

