export const OPERATION_TABLE_ALLOWLIST = [
  "atendimento",
  "financeiro",
  "movimento",
  "produto_estoque",
] as const;

export type OperationTableName = (typeof OPERATION_TABLE_ALLOWLIST)[number];

const OPERATION_TABLE_ALLOWLIST_SET = new Set<string>(OPERATION_TABLE_ALLOWLIST);

const OPERATION_TABLE_LABELS: Record<OperationTableName, string> = {
  atendimento: "Atendimento",
  financeiro: "Financeiro",
  movimento: "Movimentações",
  produto_estoque: "Estoque",
};

export function isAllowedOperationTable(tableName: string): tableName is OperationTableName {
  return OPERATION_TABLE_ALLOWLIST_SET.has(tableName);
}

export function toOperationAreaLabel(tableName: string): string {
  return (OPERATION_TABLE_LABELS as Record<string, string>)[tableName] ?? tableName;
}

export function toOperationAreasList(tableNames: string[]): string[] {
  const allowed = new Set(
    tableNames.filter((name) => OPERATION_TABLE_ALLOWLIST_SET.has(name)),
  );

  return OPERATION_TABLE_ALLOWLIST
    .filter((name) => allowed.has(name))
    .map((name) => OPERATION_TABLE_LABELS[name]);
}
