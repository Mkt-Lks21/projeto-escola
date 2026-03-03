import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
    from: vi.fn(),
  },
}));

import { sendChatMessage } from "./api";
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
  });

  it("sends access token in function authorization header", async () => {
    mockedSupabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: "token-123" } },
      error: null,
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await sendChatMessage([{ role: "user", content: "oi" }], "conv-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
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
});
