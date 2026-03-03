import { render, screen } from "@testing-library/react";
import AssistantMarkdown from "./AssistantMarkdown";

describe("AssistantMarkdown", () => {
  it("renders bold text as strong", () => {
    render(<AssistantMarkdown content="Texto **importante**." />);

    const strong = screen.getByText("importante");
    expect(strong.tagName).toBe("STRONG");
  });

  it("renders markdown heading", () => {
    render(<AssistantMarkdown content="## Titulo principal" />);

    expect(screen.getByRole("heading", { level: 2, name: "Titulo principal" })).toBeInTheDocument();
  });

  it("renders thematic break from markdown", () => {
    const { container } = render(<AssistantMarkdown content={"Bloco A\n\n---\n\nBloco B"} />);

    expect(container.querySelector("hr")).toBeInTheDocument();
  });

  it("renders markdown table structure", () => {
    render(
      <AssistantMarkdown
        content={[
          "| Trimestre | 2024 | 2025 |",
          "| :-- | :-- | :-- |",
          "| Q1 | 100 | 120 |",
          "| Q2 | 130 | 140 |",
        ].join("\n")}
      />,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Trimestre" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Q1" })).toBeInTheDocument();
  });

  it("renders bullet list markers from asterisk syntax", () => {
    render(<AssistantMarkdown content={"* **asd**\n* segundo item"} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(screen.getByText("asd").tagName).toBe("STRONG");
  });
});
