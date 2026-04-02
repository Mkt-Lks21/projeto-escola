import { useMemo, useState } from "react";
import { Message } from "@/types/database";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Copy, Check, User, Bot, Loader2 } from "lucide-react";
import { toast } from "sonner";
import InsightResultPanel from "./InsightResultPanel";
import ChartInsightPanel from "./ChartInsightPanel";
import AssistantMarkdown from "./AssistantMarkdown";
import Plot from "react-plotly.js";
import type { Config as PlotlyConfig, Data as PlotlyData, Layout as PlotlyLayout } from "plotly.js";
import { parseAssistantContent } from "@/lib/chat/assistantContentParser";
import { useLocation } from "react-router-dom";

interface ChatMessageProps {
  message: Message;
  disableAutoExecute?: boolean;
}

export default function ChatMessage({
  message,
  disableAutoExecute: _disableAutoExecute = false,
}: ChatMessageProps) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
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
    return value === "1" || value === "true" || value === "yes" || value === "on";
  }, [location.search]);

  const parsedContent = useMemo(
    () => (isUser ? null : parseAssistantContent(message.content || "")),
    [isUser, message.content],
  );

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
  const sqlDebugQuery =
    (typeof chartInsightPayload?.sql_debug === "string" ? chartInsightPayload.sql_debug : "") ||
    (typeof chartPayload?.sql_debug === "string" ? chartPayload.sql_debug : "") ||
    (typeof insightPayload?.sql_debug === "string" ? insightPayload.sql_debug : "");
  const canRenderSqlDebug = showSqlDebug && sqlDebugQuery.trim().length > 0;
  const sqlDebugBlock = canRenderSqlDebug ? (
    <div className="space-y-3">
      <div className="rounded-xl border border-white/35 glass-subtle p-3 text-xs text-muted-foreground">
        SQL debug somente leitura. A execucao de queries no frontend foi desativada.
      </div>
      <div className="rounded-2xl glass-card overflow-hidden">
        <div className="px-3 py-2 border-b border-white/35 glass-subtle flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-muted-foreground">SQL gerado</div>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 text-xs"
            onClick={() => void handleCopy(sqlDebugQuery)}
          >
            {copiedCode === sqlDebugQuery ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </Button>
        </div>
        <SyntaxHighlighter
          style={vscDarkPlus}
          language="sql"
          PreTag="div"
          className="!m-0 !rounded-none"
        >
          {sqlDebugQuery}
        </SyntaxHighlighter>
      </div>
    </div>
  ) : null;

  return (
    <div
      className={cn(
        "flex gap-3 p-3 md:p-4 rounded-2xl glass-card",
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
          <div className="space-y-4">
            <ChartInsightPanel payload={chartInsightPayload} />
            {sqlDebugBlock}
          </div>
        ) : isInsightContent ? (
          <div className="space-y-4">
            <InsightResultPanel payload={insightPayload} />
            {sqlDebugBlock}
          </div>
        ) : isChartContent ? (
          <div className="space-y-4">
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
              <div className="rounded-2xl glass-card overflow-x-auto p-2" style={{ minHeight: "280px" }}>
                <Plot
                  data={plotData}
                  layout={{
                    autosize: true,
                    ...plotLayout,
                    margin: { t: 40, r: 20, b: 40, l: 50, ...(plotLayout.margin as Record<string, number> || {}) },
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

            {sqlDebugBlock}
          </div>
        ) : sqlBlocks.length > 0 && canRenderSql ? (
          <div className="space-y-4">
            {plainAssistantText && <AssistantMarkdown content={plainAssistantText} />}

            <div className="rounded-xl border border-white/35 glass-subtle p-3 text-xs text-muted-foreground">
              SQL debug somente leitura. A execucao de queries no frontend foi desativada.
            </div>

            {sqlBlocks.map((block, index) => (
              <div key={`${message.id}-${block.id}`} className="rounded-2xl glass-card overflow-hidden">
                <div className="px-3 py-2 border-b border-white/35 glass-subtle flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-muted-foreground">SQL {index + 1}</div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 text-xs"
                    onClick={() => void handleCopy(block.query)}
                  >
                    {copiedCode === block.query ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  </Button>
                </div>

                <SyntaxHighlighter
                  style={vscDarkPlus}
                  language="sql"
                  PreTag="div"
                  className="!m-0 !rounded-none"
                >
                  {block.query}
                </SyntaxHighlighter>
              </div>
            ))}
          </div>
        ) : (
          <AssistantMarkdown
            content={plainAssistantText || (sqlBlocks.length > 0 ? "Conteudo tecnico oculto." : "Sem conteudo para exibir.")}
          />
        )}
      </div>
    </div>
  );
}
