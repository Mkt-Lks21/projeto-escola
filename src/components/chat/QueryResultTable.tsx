import { Loader2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface QueryResultTableProps {
  results?: any[];
  isLoading?: boolean;
  hasAttempted?: boolean;
}

const MAX_ROWS = 100;

export default function QueryResultTable({
  results,
  isLoading = false,
  hasAttempted = false,
}: QueryResultTableProps) {
  if (isLoading) {
    return (
      <div className="mt-3 rounded-xl glass-subtle p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Executando query...
      </div>
    );
  }

  if (!hasAttempted) return null;

  if (!results || results.length === 0) {
    return (
      <div className="mt-3 rounded-xl glass-subtle p-4 text-sm text-muted-foreground">
        Nenhum resultado encontrado.
      </div>
    );
  }

  const columns = Object.keys(results[0] ?? {});
  const visibleRows = results.slice(0, MAX_ROWS);

  return (
    <div className="mt-3 rounded-xl overflow-hidden glass-card">
      <div className="px-3 py-2 border-b border-white/35 glass-subtle text-xs font-medium text-muted-foreground">
        {results.length} linha(s) retornada(s)
      </div>
      <div className="max-h-80 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 glass-subtle z-10">
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col} className="text-xs font-semibold whitespace-nowrap">
                  {col}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row, rowIndex) => (
              <TableRow key={rowIndex} className={rowIndex % 2 === 1 ? "bg-white/30" : ""}>
                {columns.map((col) => {
                  const value = row?.[col];
                  const formatted = value === null || value === undefined ? "" : String(value);
                  return (
                    <TableCell
                      key={col}
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
      {results.length > MAX_ROWS && (
        <div className="px-3 py-2 border-t border-white/35 glass-subtle text-xs text-muted-foreground">
          Mostrando as primeiras {MAX_ROWS} linhas de {results.length}.
        </div>
      )}
    </div>
  );
}