import { useMemo } from "react";
import { useChat } from "@/hooks/useChat";
import AppSidebar from "@/components/sidebar/AppSidebar";
import ChatMessages from "@/components/chat/ChatMessages";
import ChatInput from "@/components/chat/ChatInput";
import { executeQuery } from "@/lib/api";

const Index = () => {
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

  const suggestions = useMemo(
    () => [
      "Quais tabelas existem no banco?",
      "Mostre os ultimos 10 registros de uma tabela.",
      "Quais metricas principais posso acompanhar aqui?",
    ],
    [],
  );

  return (
    <div className="flex h-screen bg-background p-4 gap-4 relative z-10">
      <AppSidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={selectConversation}
        onDeleteConversation={deleteConversation}
        onNewConversation={createNewConversation}
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
};

export default Index;

