import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ParsedInsightPayload } from "@/lib/chat/assistantContentParser";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import AssistantMarkdown from "./AssistantMarkdown";

interface InsightResultPanelProps {
  payload: ParsedInsightPayload | null;
}

const PAGE_SIZE_OPTIONS = [15, 30, 50];
const DEFAULT_PAGE_SIZE = 15;

function inferColumns(rows: Record<string, unknown>[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    Object.keys(row || {}).forEach((key) => keys.add(key));
  }
  return Array.from(keys);
}

export default function InsightResultPanel({ payload }: InsightResultPanelProps) {
  const rows = useMemo(
    () => (Array.isArray(payload?.rows) ? payload.rows.filter((row): row is Record<string, unknown> => !!row && typeof row === "object") : []),
    [payload?.rows],
  );
  const columns = useMemo(() => {
    if (Array.isArray(payload?.columns) && payload.columns.length > 0) {
      return payload.columns;
    }
    return inferColumns(rows);
  }, [payload?.columns, rows]);
  const rowCount = typeof payload?.row_count === "number" ? payload.row_count : rows.length;
  const insightText = typeof payload?.insight_text === "string" ? payload.insight_text : "";

  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [pageIndex, setPageIndex] = useState(0);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pageStart = safePageIndex * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, rows.length);
  const pagedRows = rows.slice(pageStart, pageEnd);

  const startLabel = rows.length ? pageStart + 1 : 0;
  const endLabel = rows.length ? pageEnd : 0;

  return (
    <div className="space-y-3">
      <div className="rounded-xl overflow-hidden glass-card">
        <div className="px-3 py-2 border-b border-white/35 glass-subtle">
          <div className="text-xs font-semibold text-muted-foreground">Dados analisados</div>
          <div className="text-xs text-muted-foreground">{rowCount} linha(s) retornada(s)</div>
        </div>

        {rows.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">Nenhum dado tabular foi retornado para esta analise.</div>
        ) : (
          <>
            <div className="max-h-80 overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 glass-subtle z-10">
                  <TableRow>
                    {columns.map((column) => (
                      <TableHead key={column} className="text-xs font-semibold whitespace-nowrap">
                        {column}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedRows.map((row, rowIndex) => (
                    <TableRow key={`${safePageIndex}-${rowIndex}`} className={rowIndex % 2 === 1 ? "bg-white/30" : ""}>
                      {columns.map((column) => {
                        const value = row[column];
                        const formatted = value === null || value === undefined ? "" : String(value);
                        return (
                          <TableCell
                            key={column}
                            className="text-xs max-w-[280px] truncate align-top"
                            title={formatted}
                          >
                            {formatted}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="px-3 py-2 border-t border-white/35 glass-subtle flex items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">Mostrando {startLabel}-{endLabel} de {rows.length}</div>
              <div className="flex items-center gap-2">
                <label htmlFor="insight-page-size" className="text-xs text-muted-foreground">
                  Linhas por pagina
                </label>
                <select
                  id="insight-page-size"
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPageIndex(0);
                  }}
                  className="h-8 rounded-md border border-white/35 bg-background/60 px-2 text-xs"
                >
                  {PAGE_SIZE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs"
                  onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
                  disabled={safePageIndex === 0}
                >
                  Anterior
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs"
                  onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
                  disabled={safePageIndex >= pageCount - 1}
                >
                  Proxima
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="rounded-xl border border-white/35 glass-subtle p-3">
        <div className="text-xs font-semibold text-muted-foreground mb-1">Insight</div>
        <AssistantMarkdown content={insightText || "Nao foi possivel gerar um insight textual para esta analise."} />
      </div>
    </div>
  );
}
