import { useEffect, useMemo, useState } from "react";
import { useChat } from "@/hooks/useChat";
import AppSidebar from "@/components/sidebar/AppSidebar";
import ChatMessages from "@/components/chat/ChatMessages";
import ChatInput from "@/components/chat/ChatInput";
import { executeQuery, getAgentTables } from "@/lib/api";
import { useParams, useSearchParams } from "react-router-dom";
import { AgentTable } from "@/types/database";
import MobileHeader from "@/components/layout/MobileHeader";

export default function Chat() {
  const { agentId } = useParams<{ agentId?: string }>();
  const [searchParams] = useSearchParams();
  const initialConversationId = searchParams.get("c") || undefined;
  const [agentTables, setAgentTables] = useState<AgentTable[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const {
    conversations,
    currentConversationId,
    messages,
    isLoading,
    streamingContent,
    sendMessage,
    selectConversation,
    deleteConversation,
    createNewConversation,
  } = useChat(agentId, initialConversationId);

  useEffect(() => {
    if (!agentId) {
      setAgentTables([]);
      return;
    }

    let isActive = true;
    const loadTables = async () => {
      try {
        const tables = await getAgentTables(agentId);
        if (isActive) setAgentTables(tables || []);
      } catch {
        if (isActive) setAgentTables([]);
      }
    };

    loadTables();
    return () => {
      isActive = false;
    };
  }, [agentId]);

  const handleExecuteQuery = async (query: string) => {
    return await executeQuery(query);
  };

  const greeting = useMemo(() => {
    const name = "Arquem";
    const variants = [
      "Como posso te ajudar hoje?",
      "No que voce precisa hoje?",
      "Que insight do seu banco voce quer ver?",
    ];
    const index = Math.floor(Math.random() * variants.length);
    return { title: `Ola, ${name}.`, subtitle: variants[index] };
  }, []);

  const suggestions = useMemo(() => {
    const fallback = [
      "Quais tabelas existem no banco?",
      "Mostre os ultimos 10 registros de uma tabela.",
      "Quais metricas principais posso acompanhar aqui?",
    ];

    if (!agentTables.length) return fallback;

    const toName = (table: AgentTable) => `${table.schema_name}.${table.table_name}`;
    const tableNames = agentTables.slice(0, 3).map(toName);
    const pick = (index: number) => tableNames[index] || tableNames[0];

    return [
      `Quais insights principais existem na tabela ${pick(0)}?`,
      `Mostre os 10 registros mais recentes de ${pick(1)}.`,
      `Resuma os principais indicadores de ${pick(2)} por mes.`,
    ];
  }, [agentTables]);

  return (
    <div className="flex flex-col md:flex-row h-screen bg-background p-0 md:p-4 md:gap-4 relative z-10">
      <MobileHeader
        onOpenSidebar={() => setIsSidebarOpen(true)}
        onNewConversation={createNewConversation}
      />
      <AppSidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={selectConversation}
        onDeleteConversation={deleteConversation}
        onNewConversation={createNewConversation}
        agentId={agentId}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      <main className="flex-1 flex flex-col glass-panel md:rounded-2xl overflow-hidden relative z-10">
        <ChatMessages
          messages={messages}
          isLoading={isLoading}
          streamingContent={streamingContent}
          onExecuteQuery={handleExecuteQuery}
          emptyGreeting={greeting}
          suggestions={suggestions}
          onSuggestionClick={sendMessage}
        />

        <ChatInput onSend={sendMessage} isLoading={isLoading} />
      </main>
    </div>
  );
}
