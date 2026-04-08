import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
    from: vi.fn(),
  },
}));

import {
  fetchExternalMetadata,
  sendChatMessage,
  testExternalConnection,
  transcribeChatAudio,
} from "./api";
import { supabase } from "@/integrations/supabase/client";

describe("api auth headers", () => {
  const mockedSupabase = supabase as unknown as {
    auth: {
      getSession: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
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
