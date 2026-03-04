import { useState, useEffect, useCallback } from "react";
import { Message, Conversation } from "@/types/database";
import {
  getConversations,
  createConversation,
  deleteConversation as apiDeleteConversation,
  getMessages,
  createMessage,
  sendChatMessage,
  updateConversationTitle,
} from "@/lib/api";
import { toast } from "sonner";

type ChatUsageError = {
  code?: string;
  message?: string;
  error?: string;
  usage?: {
    usedCredits?: number;
    limitCredits?: number;
    percent?: number;
    cycleEndAt?: string;
  };
};

const CURRENT_CONVERSATION_STORAGE_KEY = "currentConversationId";

export function useChat(agentId?: string, initialConversationId?: string) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(() => {
    if (initialConversationId) return initialConversationId;
    return localStorage.getItem(CURRENT_CONVERSATION_STORAGE_KEY);
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (currentConversationId) {
      loadMessages(currentConversationId);
    } else {
      setMessages([]);
    }
  }, [currentConversationId]);

  useEffect(() => {
    if (initialConversationId) {
      setCurrentConversationId(initialConversationId);
    }
  }, [initialConversationId]);

  useEffect(() => {
    if (currentConversationId) {
      localStorage.setItem(CURRENT_CONVERSATION_STORAGE_KEY, currentConversationId);
      return;
    }

    localStorage.removeItem(CURRENT_CONVERSATION_STORAGE_KEY);
  }, [currentConversationId]);

  const loadConversations = async () => {
    try {
      const data = await getConversations();
      setConversations(data);
    } catch (error) {
      console.error("Failed to load conversations:", error);
    }
  };

  const loadMessages = async (conversationId: string) => {
    try {
      const data = await getMessages(conversationId);
      setMessages(data);
    } catch (error) {
      console.error("Failed to load messages:", error);
    }
  };

  const selectConversation = useCallback((id: string) => {
    setCurrentConversationId(id);
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      await apiDeleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (currentConversationId === id) {
        setCurrentConversationId(null);
      }
      toast.success("Conversa excluída");
    } catch {
      toast.error("Erro ao excluir conversa");
    }
  }, [currentConversationId]);

  const createNewConversation = useCallback(async () => {
    try {
      const newConversation = await createConversation(undefined, agentId);
      setConversations((prev) => [newConversation, ...prev]);
      setCurrentConversationId(newConversation.id);
      return newConversation.id;
    } catch {
      toast.error("Erro ao criar conversa");
      return undefined;
    }
  }, [agentId]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;

    setIsLoading(true);
    setStreamingContent("");

    try {
      let conversationId = currentConversationId;
      if (!conversationId) {
        const newConversation = await createConversation(undefined, agentId);
        setConversations((prev) => [newConversation, ...prev]);
        conversationId = newConversation.id;
        setCurrentConversationId(conversationId);
      }

      const userMessage = await createMessage(conversationId, "user", content);
      setMessages((prev) => [...prev, userMessage]);

      if (messages.length === 0) {
        const title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
        await updateConversationTitle(conversationId, title);
        setConversations((prev) =>
          prev.map((c) => (c.id === conversationId ? { ...c, title } : c))
        );
      }

      const apiMessages = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content },
      ];

      const response = await sendChatMessage(apiMessages, conversationId, agentId);

      if (!response.ok) {
        const error: ChatUsageError = await response.json().catch(() => ({}));

        if (error.code === "USAGE_LIMIT_REACHED") {
          const percentage = typeof error.usage?.percent === "number"
            ? `${error.usage.percent.toFixed(2)}%`
            : "100%";
          throw new Error(error.message || `Seu limite mensal foi atingido (${percentage}).`);
        }

        if (error.code === "USER_NOT_LINKED_TO_ACES") {
          throw new Error(error.message || "Seu usuario nao esta vinculado a uma empresa.");
        }

        throw new Error(error.error || error.message || "Erro ao enviar mensagem");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  fullContent += content;
                  setStreamingContent(fullContent);
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }
      }

      if (fullContent) {
        const assistantMessage = await createMessage(
          conversationId,
          "assistant",
          fullContent
        );
        setMessages((prev) => [...prev, assistantMessage]);
      }

      window.dispatchEvent(new CustomEvent("billing-usage-updated"));
    } catch (error) {
      console.error("Chat error:", error);
      toast.error(error instanceof Error ? error.message : "Erro ao enviar mensagem");
    } finally {
      setIsLoading(false);
      setStreamingContent("");
    }
  }, [currentConversationId, messages, agentId]);

  return {
    conversations,
    currentConversationId,
    messages,
    isLoading,
    streamingContent,
    sendMessage,
    selectConversation,
    deleteConversation,
    createNewConversation,
  };
}
