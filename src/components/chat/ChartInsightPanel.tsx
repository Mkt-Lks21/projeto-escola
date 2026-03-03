import Plot from "react-plotly.js";
import type { Config as PlotlyConfig, Data as PlotlyData, Layout as PlotlyLayout } from "plotly.js";
import { Loader2 } from "lucide-react";
import { ParsedChartInsightPayload } from "@/lib/chat/assistantContentParser";

interface ChartInsightPanelProps {
  payload: ParsedChartInsightPayload | null;
}

interface ChartPayloadLike {
  success?: boolean;
  message?: string;
  warnings?: string[];
  plotly_figure?: {
    data?: unknown[];
    layout?: Record<string, unknown>;
  };
}

export default function ChartInsightPanel({ payload }: ChartInsightPanelProps) {
  const chartPayload = (payload?.chart_payload || null) as ChartPayloadLike | null;
  const insightText = typeof payload?.insight_text === "string" ? payload.insight_text : "";
  const rowCount = typeof payload?.row_count === "number" ? payload.row_count : null;

  const plotData = Array.isArray(chartPayload?.plotly_figure?.data)
    ? (chartPayload.plotly_figure.data as PlotlyData[])
    : [];
  const plotLayout = (chartPayload?.plotly_figure?.layout || {}) as Partial<PlotlyLayout>;

  const warnings = [
    ...(Array.isArray(payload?.warnings) ? payload.warnings : []),
    ...(Array.isArray(chartPayload?.warnings) ? chartPayload.warnings : []),
  ].filter((warning, index, all) => typeof warning === "string" && warning.trim() && all.indexOf(warning) === index);

  return (
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

      {warnings.length > 0 && (
        <div className="rounded-xl border border-white/35 glass-subtle p-3 text-xs text-muted-foreground">
          {warnings.join(" ")}
        </div>
      )}

      <div className="rounded-xl border border-white/35 glass-subtle p-3">
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="text-xs font-semibold text-muted-foreground">Insight</div>
          {rowCount !== null && (
            <div className="text-xs text-muted-foreground">{rowCount} linha(s) analisada(s)</div>
          )}
        </div>
        <p className="text-sm leading-6 whitespace-pre-wrap break-words">
          {insightText || "Nao foi possivel gerar a analise textual para este grafico."}
        </p>
      </div>
    </div>
  );
}
