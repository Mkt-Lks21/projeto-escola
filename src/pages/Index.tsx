import { useMemo, useState } from "react";
import { useChat } from "@/hooks/useChat";
import { useAuth } from "@/hooks/useAuth";
import AppSidebar from "@/components/sidebar/AppSidebar";
import ChatMessages from "@/components/chat/ChatMessages";
import ChatInput from "@/components/chat/ChatInput";
import { executeQuery } from "@/lib/api";
import MobileHeader from "@/components/layout/MobileHeader";

const Index = () => {
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
  } = useChat();

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

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

  const suggestions = useMemo(
    () => [
      "Quantos atendimentos tivemos nos últimos 7 dias?",
      "Qual é o total recebido e o total pendente neste mês?",
      "Quais produtos estão com estoque baixo e precisam de reposição?",
    ],
    [],
  );

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
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onDisplayNameChange={setDisplayName}
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
};

export default Index;
