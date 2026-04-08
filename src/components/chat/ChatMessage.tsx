import { useMemo } from "react";
import { Message } from "@/types/database";
import { cn } from "@/lib/utils";
import { User, Bot, Loader2 } from "lucide-react";
import InsightResultPanel from "./InsightResultPanel";
import ChartInsightPanel from "./ChartInsightPanel";
import AssistantMarkdown from "./AssistantMarkdown";
import Plot from "react-plotly.js";
import type { Config as PlotlyConfig, Data as PlotlyData, Layout as PlotlyLayout } from "plotly.js";
import { parseAssistantContent } from "@/lib/chat/assistantContentParser";

interface ChatMessageProps {
  message: Message;
  disableAutoExecute?: boolean;
}

export default function ChatMessage({
  message,
  disableAutoExecute: _disableAutoExecute = false,
}: ChatMessageProps) {
  const isUser = message.role === "user";

  const parsedContent = useMemo(
    () => (isUser ? null : parseAssistantContent(message.content || "")),
    [isUser, message.content],
  );

  const plainAssistantText = parsedContent?.plainText || "";
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
          </div>
        ) : isInsightContent ? (
          <div className="space-y-4">
            <InsightResultPanel payload={insightPayload} />
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
          </div>
        ) : (
          <AssistantMarkdown
            content={plainAssistantText || "Sem conteudo para exibir."}
          />
        )}
      </div>
    </div>
  );
}
