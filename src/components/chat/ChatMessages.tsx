import { useEffect, useRef } from "react";
import { Message } from "@/types/database";
import ChatMessage from "./ChatMessage";
import { Database, MessageSquare } from "lucide-react";

interface ChatMessagesProps {
  messages: Message[];
  isLoading: boolean;
  streamingContent: string;
  onExecuteQuery: (query: string, isExternal?: boolean) => Promise<any[]>;
}

export default function ChatMessages({
  messages,
  isLoading,
  streamingContent,
  onExecuteQuery,
}: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Database className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Database Analyst Agent</h2>
          <p className="text-muted-foreground mb-4">
            Faça perguntas sobre seu banco de dados, peça análises ou execute queries SQL.
          </p>
          <div className="text-sm text-muted-foreground space-y-2">
            <p className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              "Quais tabelas existem no banco?"
            </p>
            <p className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              "Mostre os últimos 10 registros da tabela users"
            </p>
            <p className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              "Crie uma view com os pedidos do mês"
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((message) => (
        <ChatMessage
          key={message.id}
          message={message}
          onExecuteQuery={onExecuteQuery}
        />
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
        />
      )}
      
      {isLoading && !streamingContent && (
        <div className="flex items-center gap-2 text-muted-foreground">
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
  );
}
