import { fireEvent, render, screen } from "@testing-library/react";
import InsightResultPanel from "./InsightResultPanel";

const buildRows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    mes: index + 1,
    categoria: `CAT-${index + 1}`,
    total: (index + 1) * 100,
  }));

describe("InsightResultPanel", () => {
  it("renders columns and rows", () => {
    render(
      <InsightResultPanel
        payload={{
          success: true,
          row_count: 2,
          columns: ["mes", "categoria", "total"],
          rows: [
            { mes: 1, categoria: "PAPEL", total: 1000 },
            { mes: 2, categoria: "ESCOLAR", total: 1200 },
          ],
          insight_text: "Resumo de insight",
        }}
      />,
    );

    expect(screen.getByText("Dados analisados")).toBeInTheDocument();
    expect(screen.getByText("mes")).toBeInTheDocument();
    expect(screen.getByText("categoria")).toBeInTheDocument();
    expect(screen.getByText("PAPEL")).toBeInTheDocument();
    expect(screen.getByText("Resumo de insight")).toBeInTheDocument();
  });

  it("changes page when clicking next", () => {
    render(
      <InsightResultPanel
        payload={{
          success: true,
          row_count: 20,
          columns: ["mes", "categoria", "total"],
          rows: buildRows(20),
          insight_text: "Insight paginado",
        }}
      />,
    );

    expect(screen.getByText("CAT-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Proxima" }));
    expect(screen.queryByText("CAT-1")).not.toBeInTheDocument();
    expect(screen.getByText("CAT-16")).toBeInTheDocument();
  });

  it("resets range when page size changes", () => {
    render(
      <InsightResultPanel
        payload={{
          success: true,
          row_count: 40,
          columns: ["mes", "categoria", "total"],
          rows: buildRows(40),
          insight_text: "Insight paginado",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Proxima" }));
    expect(screen.getByText("Mostrando 16-30 de 40")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Linhas por pagina"), { target: { value: "30" } });
    expect(screen.getByText("Mostrando 1-30 de 40")).toBeInTheDocument();
  });

  it("shows empty state and keeps insight text", () => {
    render(
      <InsightResultPanel
        payload={{
          success: true,
          row_count: 0,
          columns: [],
          rows: [],
          insight_text: "Sem dados no periodo.",
        }}
      />,
    );

    expect(screen.getByText("Nenhum dado tabular foi retornado para esta analise.")).toBeInTheDocument();
    expect(screen.getByText("Sem dados no periodo.")).toBeInTheDocument();
  });
});
