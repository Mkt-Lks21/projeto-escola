import { useEffect, useMemo, useState } from "react";
import { useChat } from "@/hooks/useChat";
import { useAuth } from "@/hooks/useAuth";
import AppSidebar from "@/components/sidebar/AppSidebar";
import ChatMessages from "@/components/chat/ChatMessages";
import ChatInput from "@/components/chat/ChatInput";
import { getAgentTables } from "@/lib/api";
import { isAllowedOperationTable, toOperationAreasList } from "@/lib/operationAreas";
import { useParams, useSearchParams } from "react-router-dom";
import { AgentTable } from "@/types/database";
import MobileHeader from "@/components/layout/MobileHeader";


export default function Chat() {
  const { agentId } = useParams<{ agentId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialConversationId = searchParams.get("c") || undefined;
  const [agentTables, setAgentTables] = useState<AgentTable[]>([]);
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState(() => user?.email?.split("@")?.[0] || "Usuario");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const sqlDebugEnabled = useMemo(() => {
    const rawValue =
      searchParams.get("sqlDebug") ??
      searchParams.get("debugSql") ??
      searchParams.get("showSql") ??
      searchParams.get("devSql") ??
      "";
    const normalized = rawValue.toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  }, [searchParams]);
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

  const greetingSubtitle = useMemo(() => {
    const variants = [
      "Como posso te ajudar hoje?",
      "No que você precisa hoje?",
      "Qual parte da sua operação você quer acompanhar?",
    ];
    const index = Math.floor(Math.random() * variants.length);
    return variants[index];
  }, []);

  const greeting = useMemo(() => {
    const normalized = displayName.trim();
    return {
      title: normalized ? `Olá, ${normalized}.` : "Olá!",
      subtitle: greetingSubtitle,
    };
  }, [displayName, greetingSubtitle]);

  const suggestions = useMemo(() => {
    const fallback = [
      "Quantos atendimentos tivemos nos últimos 7 dias?",
      "Qual é o total recebido e o total pendente neste mês?",
      "Quais produtos estão com estoque baixo e precisam de reposição?",
    ];

    if (!agentTables.length) return fallback;

    const allowedTableNames = agentTables
      .map((t: AgentTable) => t.table_name)
      .filter(isAllowedOperationTable);

    const areas = toOperationAreasList(allowedTableNames);
    if (!areas.length) return fallback;

    const pick = (index: number) => areas[index] || areas[0];

    return [
      `Como está o ${pick(0)} hoje?`,
      `Quais são os principais pontos de atenção em ${pick(1)} neste mês?`,
      `Tem algum alerta importante em ${pick(2)} agora?`,
    ];
  }, [agentTables]);

  const handleToggleSqlDebug = (value: boolean) => {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set("sqlDebug", "1");
    } else {
      next.delete("sqlDebug");
    }
    setSearchParams(next, { replace: true });
  };

  const handleSend = (text: string) => sendMessage(text, { sqlDebug: sqlDebugEnabled });
  const handleSuggestionClick = (text: string) => sendMessage(text, { sqlDebug: sqlDebugEnabled });

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
        onDisplayNameChange={setDisplayName}
      />

      <main className="flex-1 flex flex-col glass-panel md:rounded-2xl overflow-hidden relative z-10">
        <ChatMessages
          messages={messages}
          isLoading={isLoading}
          streamingContent={streamingContent}
          emptyGreeting={greeting}
          suggestions={suggestions}
          onSuggestionClick={handleSuggestionClick}
        />

        <ChatInput
          onSend={handleSend}
          isLoading={isLoading}
          sqlDebugEnabled={sqlDebugEnabled}
          onSqlDebugChange={handleToggleSqlDebug}
        />
      </main>
    </div>
  );
}
