import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import ChatInput from "./ChatInput";
import ChatMessages from "./ChatMessages";

vi.mock("./ChatMessage", () => ({
  default: () => <div data-testid="chat-message-mock" />,
}));

describe("Chat layout alignment", () => {
  it("uses max-w-4xl column in chat messages", () => {
    render(
      <ChatMessages
        messages={[]}
        isLoading={false}
        streamingContent=""
        onExecuteQuery={async () => []}
        emptyGreeting={{ title: "Ola", subtitle: "Como posso ajudar?" }}
        suggestions={["Sugestao 1"]}
        onSuggestionClick={() => undefined}
      />,
    );

    expect(screen.getByTestId("chat-messages-column")).toHaveClass("max-w-4xl");
  });

  it("uses max-w-4xl column in chat input", () => {
    render(<ChatInput onSend={() => undefined} isLoading={false} />);

    expect(screen.getByTestId("chat-input-column")).toHaveClass("max-w-4xl");
  });
});
