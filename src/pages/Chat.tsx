import { useChat } from "@/hooks/useChat";
import AppSidebar from "@/components/sidebar/AppSidebar";
import ChatMessages from "@/components/chat/ChatMessages";
import ChatInput from "@/components/chat/ChatInput";
import { executeExternalQuery } from "@/lib/api";
import { useParams } from "react-router-dom";

export default function Chat() {
  const { agentId } = useParams<{ agentId?: string }>();
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
  } = useChat(agentId);

  const handleExecuteQuery = async (query: string) => {
    return await executeExternalQuery(query);
  };

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={selectConversation}
        onDeleteConversation={deleteConversation}
        onNewConversation={createNewConversation}
        agentId={agentId}
      />

      <main className="flex-1 flex flex-col">
        <ChatMessages
          messages={messages}
          isLoading={isLoading}
          streamingContent={streamingContent}
          onExecuteQuery={handleExecuteQuery}
        />

        <ChatInput
          onSend={sendMessage}
          isLoading={isLoading}
        />
      </main>
    </div>
  );
}
