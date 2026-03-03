import { describe, expect, it } from "vitest";
import { parseAssistantContent } from "./assistantContentParser";

describe("assistantContentParser", () => {
  it("removes inline SQL from plain text when [AUTO_EXECUTE] uses raw SQL", () => {
    const content = [
      "Vou executar a consulta para responder com precisao.",
      "[AUTO_EXECUTE]",
      "SELECT EXTRACT(MONTH FROM aten_dtemissao) AS mes, SUM(ped_vlliquido) AS total_vendas",
      "FROM atendimento",
      "WHERE EXTRACT(YEAR FROM aten_dtemissao) = 2025",
      "GROUP BY mes",
      "ORDER BY mes",
    ].join("\n");

    const parsed = parseAssistantContent(content);

    expect(parsed.sqlBlocks.length).toBe(1);
    expect(parsed.sqlBlocks[0].autoExecute).toBe(true);
    expect(parsed.plainText.toLowerCase()).not.toContain("select extract");
    expect(parsed.plainText.toLowerCase()).not.toContain("from atendimento");
    expect(parsed.plainText).toContain("Vou executar a consulta");
  });

  it("keeps chart payload detection intact", () => {
    const content = `[CHART_CONTENT] {"success":true,"plotly_figure":{"data":[{"type":"bar"}],"layout":{"title":"Vendas"}}}`;
    const parsed = parseAssistantContent(content);

    expect(parsed.isChartContent).toBe(true);
    expect(parsed.chartPayload?.success).toBe(true);
    expect(parsed.isChartInsightContent).toBe(false);
    expect(parsed.isInsightContent).toBe(false);
    expect(parsed.sqlBlocks.length).toBe(0);
  });

  it("detects chart + insight payload content", () => {
    const content =
      '[CHART_INSIGHT_CONTENT] {"success":true,"row_count":8,"chart_payload":{"success":true,"plotly_figure":{"data":[{"type":"bar"}],"layout":{"title":"Comparativo"}}},"insight_text":"2025 ficou acima de 2024 em todos os trimestres.","analysis_scope":"broad","analysis_focus":"Comparacao 2024 vs 2025","warnings":["ok"]}';

    const parsed = parseAssistantContent(content);

    expect(parsed.isChartInsightContent).toBe(true);
    expect(parsed.chartInsightPayload?.success).toBe(true);
    expect(parsed.chartInsightPayload?.row_count).toBe(8);
    expect(parsed.chartInsightPayload?.chart_payload?.plotly_figure?.data).toBeTruthy();
    expect(parsed.isChartContent).toBe(false);
    expect(parsed.isInsightContent).toBe(false);
  });

  it("falls back to plain text when chart + insight payload is invalid json", () => {
    const content = '[CHART_INSIGHT_CONTENT] {"success":true';
    const parsed = parseAssistantContent(content);

    expect(parsed.isChartInsightContent).toBe(false);
    expect(parsed.chartInsightPayload).toBeNull();
    expect(parsed.plainText).toContain("[CHART_INSIGHT_CONTENT]");
  });

  it("detects insight payload content", () => {
    const content =
      '[INSIGHT_CONTENT] {"success":true,"analysis_scope":"broad","analysis_focus":"Vendas por mes","row_count":2,"columns":["mes","total"],"rows":[{"mes":1,"total":100},{"mes":2,"total":200}],"insight_text":"As vendas cresceram 100% de janeiro para fevereiro."}';

    const parsed = parseAssistantContent(content);

    expect(parsed.isInsightContent).toBe(true);
    expect(parsed.insightPayload?.success).toBe(true);
    expect(parsed.insightPayload?.columns).toEqual(["mes", "total"]);
    expect(parsed.insightPayload?.rows?.length).toBe(2);
    expect(parsed.isChartContent).toBe(false);
    expect(parsed.sqlBlocks.length).toBe(0);
  });

  it("falls back to plain text when insight payload is invalid json", () => {
    const content = '[INSIGHT_CONTENT] {"success":true';
    const parsed = parseAssistantContent(content);

    expect(parsed.isInsightContent).toBe(false);
    expect(parsed.insightPayload).toBeNull();
    expect(parsed.plainText).toContain("[INSIGHT_CONTENT]");
  });

  it("enables SQL debug only when marker is present", () => {
    const sqlDebugContent = `[SQL_DEBUG_ALLOWED]\n[AUTO_EXECUTE]\n\`\`\`sql\nSELECT 1\n\`\`\``;
    const normalContent = `[AUTO_EXECUTE]\n\`\`\`sql\nSELECT 1\n\`\`\``;

    const parsedDebug = parseAssistantContent(sqlDebugContent);
    const parsedNormal = parseAssistantContent(normalContent);

    expect(parsedDebug.allowSqlDebug).toBe(true);
    expect(parsedNormal.allowSqlDebug).toBe(false);
  });
});
