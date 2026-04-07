import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
    from: vi.fn(),
  },
}));

import { fetchExternalMetadata, sendChatMessage, testExternalConnection } from "./api";
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

  it("forwards sqlDebug flag to chat function payload", async () => {
    mockedSupabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: "token-123" } },
      error: null,
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await sendChatMessage([{ role: "user", content: "oi" }], "conv-1", undefined, true);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat");
    const payload = JSON.parse(String((options as RequestInit).body));
    expect(payload.sqlDebug).toBe(true);

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
