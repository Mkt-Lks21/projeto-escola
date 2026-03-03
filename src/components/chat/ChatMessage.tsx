import { useEffect, useMemo, useRef, useState } from "react";
import { Message } from "@/types/database";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Play, Copy, Check, User, Bot, Loader2 } from "lucide-react";
import { toast } from "sonner";
import QueryResultTable from "./QueryResultTable";
import InsightResultPanel from "./InsightResultPanel";
import ChartInsightPanel from "./ChartInsightPanel";
import Plot from "react-plotly.js";
import type { Config as PlotlyConfig, Data as PlotlyData, Layout as PlotlyLayout } from "plotly.js";
import { ParsedSqlBlock, parseAssistantContent } from "@/lib/chat/assistantContentParser";
import { useLocation } from "react-router-dom";

interface ChatMessageProps {
  message: Message;
  onExecuteQuery: (query: string) => Promise<any[]>;
  disableAutoExecute?: boolean;
}

export default function ChatMessage({
  message,
  onExecuteQuery,
  disableAutoExecute = false,
}: ChatMessageProps) {
  const [executingQueries, setExecutingQueries] = useState<Record<string, boolean>>({});
  const [queryResults, setQueryResults] = useState<Record<string, any[]>>({});
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [attemptedQueries, setAttemptedQueries] = useState<Set<string>>(new Set());
  const runningQueriesRef = useRef<Set<string>>(new Set());
  const autoAttemptedRef = useRef<Set<string>>(new Set());
  const location = useLocation();

  const isUser = message.role === "user";
  const showSqlDebug = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const rawValue =
      params.get("sqlDebug") ??
      params.get("debugSql") ??
      params.get("showSql") ??
      params.get("devSql") ??
      "";

    const value = rawValue.toLowerCase();
    return value === "1" || value === "true" || value === "yes";
  }, [location.search]);
  const parsedContent = useMemo(
    () => (isUser ? null : parseAssistantContent(message.content || "")),
    [isUser, message.content],
  );

  const toBlockKey = (block: ParsedSqlBlock) => `${message.id}-${block.id}`;

  const executeSql = async (block: ParsedSqlBlock, showSuccessToast: boolean) => {
    const key = toBlockKey(block);

    if (runningQueriesRef.current.has(key)) return;

    runningQueriesRef.current.add(key);
    setAttemptedQueries((prev) => new Set(prev).add(key));
    setExecutingQueries((prev) => ({ ...prev, [key]: true }));

    try {
      const results = await onExecuteQuery(block.query);
      setQueryResults((prev) => ({ ...prev, [key]: results }));
      if (showSuccessToast) {
        toast.success("Query executada com sucesso!");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao executar query");
    } finally {
      setExecutingQueries((prev) => ({ ...prev, [key]: false }));
      runningQueriesRef.current.delete(key);
    }
  };

  useEffect(() => {
    if (isUser || disableAutoExecute || !parsedContent || !showSqlDebug || !parsedContent.allowSqlDebug) return;

    for (const block of parsedContent.sqlBlocks) {
      if (!block.autoExecute) continue;

      const key = toBlockKey(block);
      if (autoAttemptedRef.current.has(key)) {
        continue;
      }

      autoAttemptedRef.current.add(key);
      void executeSql(block, false);
    }
  }, [disableAutoExecute, isUser, parsedContent, showSqlDebug]);

  const handleCopy = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast.success("Codigo copiado!");
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const plainAssistantText = parsedContent?.plainText || "";
  const sqlBlocks = parsedContent?.sqlBlocks || [];
  const allowSqlDebug = parsedContent?.allowSqlDebug || false;
  const canRenderSql = showSqlDebug && allowSqlDebug;
  const isChartContent = parsedContent?.isChartContent || false;
  const chartPayload = parsedContent?.chartPayload || null;
  const isChartInsightContent = parsedContent?.isChartInsightContent || false;
  const chartInsightPayload = parsedContent?.chartInsightPayload || null;
  const isInsightContent = parsedContent?.isInsightContent || false;
  const insightPayload = parsedContent?.insightPayload || null;
  const plotData = Array.isArray(chartPayload?.plotly_figure?.data)
    ? (chartPayload.plotly_figure.data as PlotlyData[])
    : [];
  const plotLayout = (chartPayload?.plotly_figure?.layout || {}) as Partial<PlotlyLayout>;

  return (
    <div
      className={cn(
        "flex gap-3 p-4 rounded-2xl glass-card",
        isUser ? "glass-card-strong" : "glass-subtle",
      )}
    >
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
          isUser ? "bg-primary text-primary-foreground" : "bg-secondary",
        )}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      <div className="flex-1 min-w-0">
        {isUser ? (
          <p className="text-sm leading-6 whitespace-pre-wrap break-words">{message.content}</p>
        ) : isChartInsightContent ? (
          <ChartInsightPanel payload={chartInsightPayload} />
        ) : isInsightContent ? (
          <InsightResultPanel payload={insightPayload} />
        ) : isChartContent ? (
          <div className="space-y-3">
            {!chartPayload ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Renderizando grafico...
              </div>
            ) : chartPayload.success === false ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3">
                <p className="text-sm font-medium">Nao foi possivel gerar o grafico.</p>
                <p className="text-sm text-muted-foreground">
                  {chartPayload.message || "Erro retornado pelo servico de graficos."}
                </p>
              </div>
            ) : (
              <div className="rounded-2xl glass-card overflow-x-auto p-2">
                <Plot
                  data={plotData}
                  layout={{
                    autosize: true,
                    ...plotLayout,
                  }}
                  config={{
                    responsive: true,
                    displaylogo: false,
                  } as Partial<PlotlyConfig>}
                  useResizeHandler
                  style={{ width: "100%", height: "100%" }}
                />
              </div>
            )}

            {Array.isArray(chartPayload?.warnings) && chartPayload.warnings.length > 0 && (
              <div className="rounded-xl border border-white/35 glass-subtle p-3 text-xs text-muted-foreground">
                {chartPayload.warnings.join(" ")}
              </div>
            )}
          </div>
        ) : sqlBlocks.length > 0 && canRenderSql ? (
          <div className="space-y-4">
            {plainAssistantText && (
              <p className="text-sm leading-6 whitespace-pre-wrap break-words">{plainAssistantText}</p>
            )}

            {sqlBlocks.map((block, index) => {
              const key = toBlockKey(block);
              const isExecuting = Boolean(executingQueries[key]);
              const hasAttempted = attemptedQueries.has(key);
              const hasResults = Object.prototype.hasOwnProperty.call(queryResults, key);

              return (
                <div key={key} className="rounded-2xl glass-card overflow-hidden">
                  <div className="px-3 py-2 border-b border-white/35 glass-subtle flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-muted-foreground">
                      {canRenderSql ? `SQL ${index + 1}` : `Consulta ${index + 1}`}{" "}
                      {block.autoExecute ? "(Auto)" : ""}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 text-xs"
                        onClick={() => void executeSql(block, true)}
                        disabled={isExecuting}
                      >
                        {isExecuting ? (
                          <Loader2 className="w-3 h-3 animate-spin mr-1" />
                        ) : (
                          <Play className="w-3 h-3 mr-1" />
                        )}
                        {hasResults ? "Reexecutar" : "Executar"}
                      </Button>
                      {canRenderSql && (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 text-xs"
                          onClick={() => void handleCopy(block.query)}
                        >
                          {copiedCode === block.query ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </Button>
                      )}
                    </div>
                  </div>

                  {canRenderSql && (
                    <SyntaxHighlighter
                      style={vscDarkPlus}
                      language="sql"
                      PreTag="div"
                      className="!m-0 !rounded-none"
                    >
                      {block.query}
                    </SyntaxHighlighter>
                  )}

                  <div className="px-3 pb-3">
                    <QueryResultTable
                      results={queryResults[key]}
                      isLoading={isExecuting}
                      hasAttempted={hasAttempted}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm leading-6 whitespace-pre-wrap break-words">
            {plainAssistantText || (sqlBlocks.length > 0 ? "Conteudo tecnico oculto." : "Sem conteudo para exibir.")}
          </p>
        )}
      </div>
    </div>
  );
}
