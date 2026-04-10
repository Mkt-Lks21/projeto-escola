import { useState, useEffect, useCallback } from "react";
import { Message, Conversation } from "@/types/database";
import {
  AppApiError,
  getConversations,
  createConversation,
  deleteConversation as apiDeleteConversation,
  getMessages,
  createMessage,
  transcribeChatAudio,
  reportFrontendError,
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

type ChatSendStage =
  | "ensureConversation"
  | "persistUserMessage"
  | "requestChat"
  | "persistAssistantMessage";

type ConversationContext = {
  conversationId: string;
  existingMessages: Message[];
  isConversationEmpty: boolean;
};

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code.trim() : undefined;
}

function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  return fallbackMessage;
}

function getUserFacingSendErrorMessage(error: unknown): string {
  if (error instanceof AppApiError) {
    if (error.stage === "auth") {
      return error.message;
    }

    return "Nao foi possivel salvar sua mensagem.";
  }

  return getErrorMessage(error, "Erro ao enviar mensagem");
}

function logChatStageError(
  stage: ChatSendStage,
  conversationId: string | null,
  error: unknown,
  retried: boolean,
  agentId?: string,
) {
  const message = getErrorMessage(error, "Erro desconhecido.");
  const code = error instanceof AppApiError ? error.code : getErrorCode(error);

  console.error("[useChat] sendMessage stage failed", {
    stage,
    conversationId,
    code,
    message,
    retried,
  });

  void reportFrontendError({
    category: "chat_send",
    stage,
    code,
    conversationId,
    message,
    metadata: {
      retried,
      agentId: agentId ?? null,
    },
  });
}

export function useChat(agentId?: string, initialConversationId?: string) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(() => {
    if (initialConversationId) return initialConversationId;
    return localStorage.getItem(CURRENT_CONVERSATION_STORAGE_KEY);
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [hasLoadedConversations, setHasLoadedConversations] = useState(false);

  const loadConversations = useCallback(async () => {
    try {
      const data = await getConversations();
      setConversations(data);
      setCurrentConversationId((previousConversationId) => {
        if (!previousConversationId) return previousConversationId;

        const exists = data.some((conversation) => conversation.id === previousConversationId);
        return exists ? previousConversationId : null;
      });
    } catch (error) {
      console.error("Failed to load conversations:", error);
    } finally {
      setHasLoadedConversations(true);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const data = await getMessages(conversationId);
      setMessages(data);
    } catch (error) {
      console.error("Failed to load messages:", error);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (currentConversationId) {
      void loadMessages(currentConversationId);
    } else {
      setMessages([]);
    }
  }, [currentConversationId, loadMessages]);

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

  const selectConversation = useCallback((id: string) => {
    setCurrentConversationId(id);
  }, []);

  const prependConversation = useCallback((conversation: Conversation) => {
    setConversations((previousConversations) => [
      conversation,
      ...previousConversations.filter((item) => item.id !== conversation.id),
    ]);
  }, []);

  const createAndActivateConversation = useCallback(async (options?: { resetMessages?: boolean }) => {
    const newConversation = await createConversation(undefined, agentId);
    prependConversation(newConversation);
    setCurrentConversationId(newConversation.id);

    if (options?.resetMessages) {
      setMessages([]);
    }

    return newConversation;
  }, [agentId, prependConversation]);

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
      const newConversation = await createAndActivateConversation({ resetMessages: true });
      return newConversation.id;
    } catch (error) {
      console.error("Failed to create new conversation:", error);
      toast.error("Erro ao criar conversa");
      return undefined;
    }
  }, [createAndActivateConversation]);

  const ensureConversation = useCallback(async (): Promise<ConversationContext> => {
    if (currentConversationId) {
      if (!hasLoadedConversations || conversations.some((conversation) => conversation.id === currentConversationId)) {
        return {
          conversationId: currentConversationId,
          existingMessages: messages,
          isConversationEmpty: messages.length === 0,
        };
      }

      try {
        const replacementConversation = await createAndActivateConversation({ resetMessages: true });
        toast.success("A conversa anterior ficou indisponivel. Criamos uma nova para voce.");
        return {
          conversationId: replacementConversation.id,
          existingMessages: [],
          isConversationEmpty: true,
        };
      } catch (error) {
        logChatStageError("ensureConversation", currentConversationId, error, false, agentId);
        throw error;
      }
    }

    try {
      const newConversation = await createAndActivateConversation({ resetMessages: true });
      return {
        conversationId: newConversation.id,
        existingMessages: [],
        isConversationEmpty: true,
      };
    } catch (error) {
      logChatStageError("ensureConversation", currentConversationId, error, false, agentId);
      throw error;
    }
  }, [
    agentId,
    conversations,
    createAndActivateConversation,
    currentConversationId,
    hasLoadedConversations,
    messages,
  ]);

  const persistUserMessage = useCallback(async (
    conversationContext: ConversationContext,
    content: string,
  ): Promise<ConversationContext & { userMessage: Message }> => {
    try {
      const userMessage = await createMessage(conversationContext.conversationId, "user", content);
      return {
        ...conversationContext,
        userMessage,
      };
    } catch (error) {
      if (error instanceof AppApiError && error.retryable) {
        logChatStageError("persistUserMessage", conversationContext.conversationId, error, false, agentId);

        let replacementConversation: Conversation;
        try {
          replacementConversation = await createAndActivateConversation({ resetMessages: true });
          toast.success("A conversa anterior ficou indisponivel. Criamos uma nova para voce.");
        } catch (replacementError) {
          logChatStageError("persistUserMessage", conversationContext.conversationId, replacementError, true, agentId);
          throw replacementError;
        }

        try {
          const userMessage = await createMessage(replacementConversation.id, "user", content);
          return {
            conversationId: replacementConversation.id,
            existingMessages: [],
            isConversationEmpty: true,
            userMessage,
          };
        } catch (retryError) {
          logChatStageError("persistUserMessage", replacementConversation.id, retryError, true, agentId);
          throw retryError;
        }
      }

      logChatStageError("persistUserMessage", conversationContext.conversationId, error, false, agentId);
      throw error;
    }
  }, [agentId, createAndActivateConversation]);

  const requestChat = useCallback(async (
    apiMessages: { role: string; content: string }[],
    conversationId: string,
  ): Promise<Response> => {
    try {
      const response = await sendChatMessage(apiMessages, conversationId, agentId);

      if (!response.ok) {
        const error: ChatUsageError = await response.json().catch(() => ({}));

        if (response.status === 401) {
          throw new Error(error.message || "Sessao expirada. Faca login novamente.");
        }

        if (response.status === 429 || error.code === "USAGE_LIMIT_REACHED") {
          const percentage = typeof error.usage?.percent === "number"
            ? `${error.usage.percent.toFixed(2)}%`
            : "100%";
          throw new Error(error.message || `Seu limite mensal foi atingido (${percentage}).`);
        }

        if (response.status === 403 && error.code === "PROFILE_NOT_FOUND") {
          throw new Error(error.message || "Perfil de faturamento nao encontrado.");
        }

        if (response.status === 403 && error.code === "USER_NOT_LINKED_TO_ACES") {
          throw new Error(error.message || "Seu usuario nao esta vinculado a uma empresa.");
        }

        throw new Error(error.error || error.message || "Erro ao enviar mensagem");
      }

      return response;
    } catch (error) {
      logChatStageError("requestChat", conversationId, error, false, agentId);
      throw error;
    }
  }, [agentId]);

  const persistAssistantMessage = useCallback(async (conversationId: string, content: string) => {
    try {
      return await createMessage(conversationId, "assistant", content);
    } catch (error) {
      logChatStageError("persistAssistantMessage", conversationId, error, false, agentId);
      throw error;
    }
  }, [agentId]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;

    setIsLoading(true);
    setStreamingContent("");

    try {
      const conversationContext = await ensureConversation();
      const persistedUserMessage = await persistUserMessage(conversationContext, content);
      const { conversationId } = persistedUserMessage;

      setMessages((previousMessages) => [...previousMessages, persistedUserMessage.userMessage]);

      if (persistedUserMessage.isConversationEmpty) {
        const title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
        try {
          await updateConversationTitle(conversationId, title);
          setConversations((previousConversations) =>
            previousConversations.map((conversation) =>
              conversation.id === conversationId ? { ...conversation, title } : conversation
            )
          );
        } catch (error) {
          logChatStageError("persistUserMessage", conversationId, error, false, agentId);
        }
      }

      const apiMessages = [
        ...persistedUserMessage.existingMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        { role: "user", content },
      ];

      const response = await requestChat(apiMessages, conversationId);

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
        const assistantMessage = await persistAssistantMessage(conversationId, fullContent);
        setMessages((prev) => [...prev, assistantMessage]);
      }

      window.dispatchEvent(new CustomEvent("billing-usage-updated"));
    } catch (error) {
      toast.error(getUserFacingSendErrorMessage(error));
    } finally {
      setIsLoading(false);
      setStreamingContent("");
    }
  }, [ensureConversation, persistAssistantMessage, persistUserMessage, requestChat]);

  const sendAudioMessage = useCallback(async (audio: Blob) => {
    if (!audio.size) return;

    setIsLoading(true);
    setStreamingContent("");

    try {
      const audioFile = new File([audio], `audio-${Date.now()}.webm`, {
        type: audio.type || "audio/webm",
      });
      const transcription = await transcribeChatAudio(audioFile, agentId);
      const transcript = typeof transcription?.transcript === "string" ? transcription.transcript : "";

      if (!transcript.trim()) {
        throw new Error("Nao foi possivel transcrever o audio.");
      }

      await sendMessage(transcript.trim());
    } catch (error) {
      console.error("Audio chat error:", error);
      void reportFrontendError({
        category: "chat_audio",
        stage: "transcribe",
        message: getErrorMessage(error, "Erro ao transcrever audio"),
        code: getErrorCode(error) ?? null,
        metadata: {
          agentId: agentId ?? null,
          audioSize: audio.size,
        },
      });
      toast.error(error instanceof Error ? error.message : "Erro ao transcrever audio");
      throw error;
    } finally {
      setIsLoading(false);
      setStreamingContent("");
    }
  }, [agentId, sendMessage]);

  return {
    conversations,
    currentConversationId,
    messages,
    isLoading,
    streamingContent,
    sendMessage,
    sendAudioMessage,
    selectConversation,
    deleteConversation,
    createNewConversation,
  };
}
