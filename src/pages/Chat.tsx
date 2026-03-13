import { useEffect, useMemo, useState } from "react";
import { useChat } from "@/hooks/useChat";
import { useAuth } from "@/hooks/useAuth";
import AppSidebar from "@/components/sidebar/AppSidebar";
import ChatMessages from "@/components/chat/ChatMessages";
import ChatInput from "@/components/chat/ChatInput";
import { executeQuery, getAgentTables } from "@/lib/api";
import { isAllowedOperationTable, toOperationAreasList } from "@/lib/operationAreas";
import { useParams, useSearchParams } from "react-router-dom";
import { AgentTable } from "@/types/database";


export default function Chat() {
  const { agentId } = useParams<{ agentId?: string }>();
  const [searchParams] = useSearchParams();
  const initialConversationId = searchParams.get("c") || undefined;
  const [agentTables, setAgentTables] = useState<AgentTable[]>([]);
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState(() => user?.email?.split("@")?.[0] || "Usuario");
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

  return (
    <div className="flex h-screen bg-background p-4 gap-4 relative z-10">
      <AppSidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={selectConversation}
        onDeleteConversation={deleteConversation}
        onNewConversation={createNewConversation}
        agentId={agentId}
        onDisplayNameChange={setDisplayName}
      />

      <main className="flex-1 flex flex-col glass-panel rounded-2xl overflow-hidden relative z-10">
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
