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
    expect(parsed.sqlBlocks.length).toBe(0);
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

