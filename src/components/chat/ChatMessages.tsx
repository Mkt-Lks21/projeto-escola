import { useEffect, useRef } from "react";
import { Message } from "@/types/database";
import ChatMessage from "./ChatMessage";

interface ChatMessagesProps {
  messages: Message[];
  isLoading: boolean;
  streamingContent: string;
  onExecuteQuery: (query: string) => Promise<any[]>;
  emptyGreeting: { title: string; subtitle: string };
  suggestions: string[];
  onSuggestionClick: (text: string) => void;
}

export default function ChatMessages({
  messages,
  isLoading,
  streamingContent,
  onExecuteQuery,
  emptyGreeting,
  suggestions,
  onSuggestionClick,
}: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center px-3 sm:px-4 md:px-6 py-8 pb-40">
        <div className="w-full max-w-4xl mx-auto" data-testid="chat-messages-column">
          <div className="max-w-2xl space-y-2">
            <h2 className="text-2xl font-semibold break-words">{emptyGreeting.title}</h2>
            <p className="text-muted-foreground text-lg break-words">{emptyGreeting.subtitle}</p>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSuggestionClick(suggestion)}
                className="px-4 py-2 rounded-full text-sm glass-subtle hover:glass-card transition-colors border border-white/40"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-scroll-area flex-1 overflow-y-auto px-3 sm:px-4 md:px-6 pt-6 pb-40">
      <div className="w-full max-w-4xl mx-auto space-y-4" data-testid="chat-messages-column">
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} onExecuteQuery={onExecuteQuery} />
        ))}

        {isLoading && streamingContent && (
          <ChatMessage
            message={{
              id: "streaming",
              role: "assistant",
              content: streamingContent,
              conversation_id: "",
              created_at: new Date().toISOString(),
            }}
            onExecuteQuery={onExecuteQuery}
            disableAutoExecute
          />
        )}

        {isLoading && !streamingContent && (
          <div className="flex items-center gap-2 text-muted-foreground glass-subtle rounded-full px-4 py-2 w-fit">
            <div className="animate-pulse flex gap-1">
              <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
            <span className="text-sm">Pensando...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
