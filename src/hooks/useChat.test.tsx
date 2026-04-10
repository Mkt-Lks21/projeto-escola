import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      getUser: vi.fn(),
    },
    from: vi.fn(),
  },
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");

  return {
    ...actual,
    getConversations: vi.fn(),
    createConversation: vi.fn(),
    deleteConversation: vi.fn(),
    getMessages: vi.fn(),
    createMessage: vi.fn(),
    reportFrontendError: vi.fn(),
    transcribeChatAudio: vi.fn(),
    sendChatMessage: vi.fn(),
    updateConversationTitle: vi.fn(),
  };
});

import { toast } from "sonner";
import {
  AppApiError,
  createConversation,
  createMessage,
  getConversations,
  getMessages,
  reportFrontendError,
  sendChatMessage,
  updateConversationTitle,
} from "@/lib/api";
import { useChat } from "./useChat";

type DeferredPromise<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error?: unknown) => void;
};

function createDeferred<T>(): DeferredPromise<T> {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;

  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

function makeConversation(id: string) {
  return {
    id,
    title: "Nova Conversa",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    user_id: "user-1",
  };
}

function makeMessage(id: string, conversationId: string, role: "user" | "assistant", content: string) {
  return {
    id,
    conversation_id: conversationId,
    role,
    content,
    created_at: new Date().toISOString(),
  };
}

describe("useChat", () => {
  const mockedToast = toast as unknown as {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  const mockedApi = {
    getConversations: vi.mocked(getConversations),
    createConversation: vi.mocked(createConversation),
    getMessages: vi.mocked(getMessages),
    createMessage: vi.mocked(createMessage),
    reportFrontendError: vi.mocked(reportFrontendError),
    sendChatMessage: vi.mocked(sendChatMessage),
    updateConversationTitle: vi.mocked(updateConversationTitle),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});

    mockedApi.getConversations.mockResolvedValue([]);
    mockedApi.getMessages.mockResolvedValue([]);
    mockedApi.createConversation.mockResolvedValue(makeConversation("conv-1"));
    mockedApi.createMessage.mockResolvedValue(makeMessage("msg-1", "conv-1", "user", "Oi"));
    mockedApi.reportFrontendError.mockResolvedValue(undefined);
    mockedApi.sendChatMessage.mockResolvedValue(new Response(null, { status: 200 }));
    mockedApi.updateConversationTitle.mockResolvedValue(undefined);
  });

  it("clears stale currentConversationId from localStorage after loading conversations", async () => {
    localStorage.setItem("currentConversationId", "conv-stale");
    mockedApi.getConversations.mockResolvedValue([makeConversation("conv-valid")]);

    const { result } = renderHook(() => useChat());

    await waitFor(() => {
      expect(result.current.currentConversationId).toBeNull();
    });

    expect(localStorage.getItem("currentConversationId")).toBeNull();
  });

  it("recreates the conversation and retries once when the stored conversation is invalid", async () => {
    const replacementConversation = makeConversation("conv-new");
    const deferredConversations = createDeferred<ReturnType<typeof makeConversation>[]>();

    mockedApi.getConversations.mockReturnValueOnce(deferredConversations.promise);
    mockedApi.getMessages.mockResolvedValue([]);
    mockedApi.createConversation.mockResolvedValue(replacementConversation);
    mockedApi.createMessage
      .mockRejectedValueOnce(new AppApiError({
        stage: "createMessage",
        code: "23503",
        retryable: true,
        message: "insert or update on table \"messages\" violates foreign key constraint",
      }))
      .mockResolvedValueOnce(makeMessage("msg-2", replacementConversation.id, "user", "Oi"));

    const { result } = renderHook(() => useChat(undefined, "conv-stale"));

    await act(async () => {
      const sending = result.current.sendMessage("Oi");
      await Promise.resolve();
      deferredConversations.resolve([replacementConversation]);
      await sending;
    });

    await waitFor(() => {
      expect(mockedApi.createMessage).toHaveBeenCalledTimes(2);
    });

    expect(mockedApi.createMessage).toHaveBeenNthCalledWith(1, "conv-stale", "user", "Oi");
    expect(mockedApi.createMessage).toHaveBeenNthCalledWith(2, replacementConversation.id, "user", "Oi");
    expect(mockedApi.sendChatMessage).toHaveBeenCalledWith(
      [{ role: "user", content: "Oi" }],
      replacementConversation.id,
      undefined,
    );
    expect(mockedToast.success).toHaveBeenCalledWith(
      "A conversa anterior ficou indisponivel. Criamos uma nova para voce.",
    );
    expect(result.current.currentConversationId).toBe(replacementConversation.id);
  });

  it("stops before sendChatMessage when the session is expired", async () => {
    mockedApi.createConversation.mockRejectedValue(new AppApiError({
      stage: "auth",
      code: "AUTH_SESSION_MISSING",
      message: "Sessao expirada. Faca login novamente.",
    }));

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.sendMessage("Oi");
    });

    expect(mockedApi.createMessage).not.toHaveBeenCalled();
    expect(mockedApi.sendChatMessage).not.toHaveBeenCalled();
    expect(mockedToast.error).toHaveBeenCalledWith("Sessao expirada. Faca login novamente.");
    expect(mockedApi.reportFrontendError).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "chat_send",
        stage: "ensureConversation",
        message: "Sessao expirada. Faca login novamente.",
      }),
    );
  });

  it("waits for the user message insert before calling sendChatMessage", async () => {
    const createdConversation = makeConversation("conv-sequential");
    const deferredMessage = createDeferred<ReturnType<typeof makeMessage>>();

    mockedApi.createConversation.mockResolvedValue(createdConversation);
    mockedApi.createMessage.mockReturnValueOnce(deferredMessage.promise);

    const { result } = renderHook(() => useChat());

    let sendingPromise: Promise<void> | undefined;
    await act(async () => {
      sendingPromise = result.current.sendMessage("Oi");
      await Promise.resolve();
    });

    expect(mockedApi.sendChatMessage).not.toHaveBeenCalled();

    deferredMessage.resolve(makeMessage("msg-seq", createdConversation.id, "user", "Oi"));

    await act(async () => {
      await sendingPromise;
    });

    expect(mockedApi.sendChatMessage).toHaveBeenCalledWith(
      [{ role: "user", content: "Oi" }],
      createdConversation.id,
      undefined,
    );
  });
});
