import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      getUser: vi.fn(),
    },
    from: vi.fn(),
  },
}));

import {
  AppApiError,
  createConversation,
  createMessage,
  fetchExternalMetadata,
  flushPendingFrontendErrorLogs,
  getMyFrontendErrorLogs,
  reportFrontendError,
  sendChatMessage,
  testExternalConnection,
  transcribeChatAudio,
} from "./api";
import { supabase } from "@/integrations/supabase/client";

type MockFunction = ReturnType<typeof vi.fn>;

function createSingleInsertBuilder<T>(result: { data: T; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });

  return { insert, select, single };
}

function createInsertOnlyBuilder(result: { error: unknown }) {
  const insert = vi.fn().mockResolvedValue(result);
  return { insert };
}

function createSelectListBuilder<T>(result: { data: T; error: unknown }) {
  const limit = vi.fn().mockResolvedValue(result);
  const order = vi.fn().mockReturnValue({ limit });
  const select = vi.fn().mockReturnValue({ order });

  return { select, order, limit };
}

describe("api auth headers", () => {
  const mockedSupabase = supabase as unknown as {
    auth: {
      getSession: MockFunction;
      getUser: MockFunction;
    };
    from: MockFunction;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pk-test");
    vi.stubEnv("VITE_BACKEND_API_URL", "/api");
  });

  it("sends access token in chat endpoint authorization header", async () => {
    mockedSupabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: "token-123" } },
      error: null,
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await sendChatMessage([{ role: "user", content: "oi" }], "conv-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat");
    expect((options as RequestInit).headers).toMatchObject({
      apikey: "pk-test",
      Authorization: "Bearer token-123",
      "Content-Type": "application/json",
    });

    fetchMock.mockRestore();
  });

  it("throws when there is no active session", async () => {
    mockedSupabase.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await expect(
      sendChatMessage([{ role: "user", content: "oi" }], "conv-1"),
    ).rejects.toThrow("Sessao expirada");
  });

  it("persists conversations with explicit user_id", async () => {
    mockedSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });

    const conversation = {
      id: "conv-1",
      title: "Nova Conversa",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      user_id: "user-1",
    };
    const builder = createSingleInsertBuilder({ data: conversation, error: null });
    mockedSupabase.from.mockReturnValue(builder);

    await createConversation(undefined, "agent-1");

    expect(mockedSupabase.from).toHaveBeenCalledWith("conversations");
    expect(builder.insert).toHaveBeenCalledWith({
      title: "Nova Conversa",
      user_id: "user-1",
      agent_id: "agent-1",
    });
  });

  it("throws auth error when creating a conversation without session", async () => {
    mockedSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    await expect(createConversation()).rejects.toEqual(
      expect.objectContaining<AppApiError>({
        stage: "auth",
        code: "AUTH_SESSION_MISSING",
        message: "Sessao expirada. Faca login novamente.",
      }),
    );
    expect(mockedSupabase.from).not.toHaveBeenCalled();
  });

  it("throws auth error when creating a message without session", async () => {
    mockedSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    await expect(createMessage("conv-1", "user", "oi")).rejects.toEqual(
      expect.objectContaining<AppApiError>({
        stage: "auth",
        code: "AUTH_SESSION_MISSING",
        message: "Sessao expirada. Faca login novamente.",
      }),
    );
    expect(mockedSupabase.from).not.toHaveBeenCalled();
  });

  it("queues frontend errors locally when there is no active session", async () => {
    mockedSupabase.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await reportFrontendError({
      category: "chat_send",
      stage: "persistUserMessage",
      message: "Nao foi possivel salvar sua mensagem.",
    });

    const stored = JSON.parse(localStorage.getItem("pendingFrontendErrorLogs") || "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      category: "chat_send",
      stage: "persistUserMessage",
      message: "Nao foi possivel salvar sua mensagem.",
    });
  });

  it("flushes pending frontend errors when a session is available", async () => {
    localStorage.setItem("pendingFrontendErrorLogs", JSON.stringify([
      {
        category: "chat_send",
        stage: "requestChat",
        message: "Erro ao enviar mensagem",
      },
    ]));

    mockedSupabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: "token-123" } },
      error: null,
    });

    const builder = createInsertOnlyBuilder({ error: null });
    mockedSupabase.from.mockReturnValue(builder);

    await flushPendingFrontendErrorLogs();

    expect(mockedSupabase.from).toHaveBeenCalledWith("frontend_error_logs");
    expect(builder.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        category: "chat_send",
        stage: "requestChat",
        message: "Erro ao enviar mensagem",
      }),
    ]);
    expect(localStorage.getItem("pendingFrontendErrorLogs")).toBeNull();
  });

  it("returns synced frontend logs for the current user", async () => {
    mockedSupabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: "token-123" } },
      error: null,
    });

    const selectBuilder = createSelectListBuilder({
      data: [
        {
          id: "log-1",
          user_id: "user-1",
          category: "chat_send",
          stage: "persistUserMessage",
          code: "23503",
          message: "Nao foi possivel salvar sua mensagem.",
          pathname: "/chat",
          user_agent: "Mobile Safari",
          conversation_id: "conv-1",
          metadata: { retried: true },
          created_at: new Date().toISOString(),
        },
      ],
      error: null,
    });

    mockedSupabase.from.mockReturnValue(selectBuilder);

    const logs = await getMyFrontendErrorLogs(10);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      id: "log-1",
      category: "chat_send",
      stage: "persistUserMessage",
      code: "23503",
      pathname: "/chat",
    });
    expect(selectBuilder.limit).toHaveBeenCalledWith(10);
  });

  it("sends chat payload without sqlDebug", async () => {
    mockedSupabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: "token-123" } },
      error: null,
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await sendChatMessage([{ role: "user", content: "oi" }], "conv-1", "agent-1");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat");
    const payload = JSON.parse(String((options as RequestInit).body));
    expect(payload).toMatchObject({
      messages: [{ role: "user", content: "oi" }],
      conversationId: "conv-1",
      agentId: "agent-1",
    });
    expect(payload.sqlDebug).toBeUndefined();

    fetchMock.mockRestore();
  });

  it("sends multipart audio transcription request", async () => {
    mockedSupabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: "token-123" } },
      error: null,
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ transcript: "oi mundo" }), { status: 200 }));

    const file = new File(["audio-bytes"], "audio.webm", { type: "audio/webm" });
    await transcribeChatAudio(file, "agent-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat/transcribe");
    expect((options as RequestInit).headers).toMatchObject({
      apikey: "pk-test",
      Authorization: "Bearer token-123",
    });
    expect((options as RequestInit).headers).not.toHaveProperty("Content-Type");
    expect((options as RequestInit).body).toBeInstanceOf(FormData);

    const body = options?.body as FormData;
    expect(body.get("agentId")).toBe("agent-1");
    const audio = body.get("audio");
    expect(audio).toBeInstanceOf(File);

    fetchMock.mockRestore();
  });

  it("uses backend api base url when set for metadata calls", async () => {
    vi.stubEnv("VITE_BACKEND_API_URL", "/api");
    mockedSupabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: "token-123" } },
      error: null,
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        new Response(JSON.stringify({ success: true, data: [], message: "ok" }), { status: 200 }));

    await fetchExternalMetadata();
    await testExternalConnection();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/external-db-admin",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/external-db-admin",
      expect.objectContaining({ method: "POST" }),
    );

    fetchMock.mockRestore();
  });
});
