import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  handleExternalDbProxyRequest,
  requireInternalProxyKey,
  resetCachedDelphiAuthTokenForTests,
  setDelphiHttpRequesterForTests,
  resolveDelphiBearerToken,
} from "./index.ts";
import { assertOutboundUrlAllowed } from "../_shared/security.ts";

async function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<void> | void,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(overrides)) {
    previous.set(key, Deno.env.get(key));
    const value = overrides[key];
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }

  try {
    await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
  }
}

Deno.test("requireInternalProxyKey accepts the configured internal secret", () => {
  const previous = Deno.env.get("INTERNAL_PROXY_KEY");
  Deno.env.set("INTERNAL_PROXY_KEY", "internal-proxy-secret");

  try {
    const request = new Request("https://example.com/functions/v1/external-db-proxy", {
      method: "POST",
      headers: {
        "x-internal-proxy-key": "internal-proxy-secret",
      },
    });

    assertEquals(requireInternalProxyKey(request), "internal-proxy-secret");
  } finally {
    if (previous === undefined) {
      Deno.env.delete("INTERNAL_PROXY_KEY");
    } else {
      Deno.env.set("INTERNAL_PROXY_KEY", previous);
    }
  }
});

Deno.test("resolveDelphiBearerToken returns fresh token from auth endpoint", async () => {
  resetCachedDelphiAuthTokenForTests();

  const result = await resolveDelphiBearerToken({
    authUrl: new URL("https://auth.example.com/auth?tokenapi=redacted"),
    requestId: "req-auth-fresh",
    fetcher: async () =>
      new Response(JSON.stringify({ token: "fresh-token-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  });

  assertEquals(result.token, "fresh-token-1");
  assertEquals(result.authMode, "fresh");
  assertEquals(result.authAttempt, 1);
});

Deno.test("resolveDelphiBearerToken retries auth and recovers on second attempt", async () => {
  resetCachedDelphiAuthTokenForTests();

  let attempt = 0;
  const result = await resolveDelphiBearerToken({
    authUrl: new URL("https://auth.example.com/auth?tokenapi=redacted"),
    requestId: "req-auth-retry",
    sleepFn: async () => {},
    fetcher: async () => {
      attempt += 1;
      if (attempt === 1) {
        return new Response("temporarily unavailable", { status: 503 });
      }
      return new Response(JSON.stringify({ token: "retry-token-ok" }), { status: 200 });
    },
  });

  assertEquals(attempt, 2);
  assertEquals(result.token, "retry-token-ok");
  assertEquals(result.authMode, "fresh");
  assertEquals(result.authAttempt, 2);
});

Deno.test("resolveDelphiBearerToken falls back to cache when auth fails", async () => {
  resetCachedDelphiAuthTokenForTests();

  await resolveDelphiBearerToken({
    authUrl: new URL("https://auth.example.com/auth?tokenapi=redacted"),
    requestId: "req-cache-seed",
    nowFn: () => 1_000,
    fetcher: async () => new Response(JSON.stringify({ token: "cached-token" }), { status: 200 }),
  });

  let failedAttempts = 0;
  const result = await resolveDelphiBearerToken({
    authUrl: new URL("https://auth.example.com/auth?tokenapi=redacted"),
    requestId: "req-cache-fallback",
    nowFn: () => 1_000 + 120_000,
    cacheMaxAgeSec: 300,
    sleepFn: async () => {},
    fetcher: async () => {
      failedAttempts += 1;
      throw new Error("network offline");
    },
  });

  assertEquals(failedAttempts, 3);
  assertEquals(result.token, "cached-token");
  assertEquals(result.authMode, "cache_fallback");
});

Deno.test("resolveDelphiBearerToken fails when auth fails and cache is unavailable", async () => {
  resetCachedDelphiAuthTokenForTests();

  await assertRejects(
    () =>
      resolveDelphiBearerToken({
        authUrl: new URL("https://auth.example.com/auth?tokenapi=redacted"),
        requestId: "req-auth-fail",
        sleepFn: async () => {},
        fetcher: async () => {
          throw new Error("connection refused");
        },
      }),
    Error,
    "Nao foi possivel autenticar no Delphi no momento.",
  );
});

Deno.test("resolveDelphiBearerToken treats missing token field as auth failure", async () => {
  resetCachedDelphiAuthTokenForTests();

  await assertRejects(
    () =>
      resolveDelphiBearerToken({
        authUrl: new URL("https://auth.example.com/auth?tokenapi=redacted"),
        requestId: "req-auth-token-missing",
        sleepFn: async () => {},
        fetcher: async () => new Response(JSON.stringify({ not_token: "abc" }), { status: 200 }),
      }),
    Error,
    "Nao foi possivel autenticar no Delphi no momento.",
  );
});

Deno.test("handleExternalDbProxyRequest sends rotating auth bearer to Delphi API", async () => {
  resetCachedDelphiAuthTokenForTests();
  let capturedAuthHeader = "";
  setDelphiHttpRequesterForTests(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://auth.example.com")) {
      return new Response(JSON.stringify({ token: "rotating-bearer-1" }), { status: 200 });
    }

    if (url.startsWith("https://api.example.com")) {
      const headers = new Headers(init?.headers);
      capturedAuthHeader = headers.get("Authorization") || "";
      return new Response(
        JSON.stringify({
          RESULT: [{
            data: [{ id: 1 }],
            pageNumber: 1,
            totalPages: 1,
            totalRec: 1,
          }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  });

  try {
    await withEnv(
      {
        INTERNAL_PROXY_KEY: "internal-proxy-secret",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        DELPHI_API_URL: "https://api.example.com/query",
        DELPHI_API_TOKEN: "token-api-value",
        DELPHI_AUTH_URL: "https://auth.example.com/auth?tokenapi=redacted",
        ALLOWED_PROXY_HOSTS: "api.example.com,auth.example.com",
      },
      async () => {
        const req = new Request("https://example.com/functions/v1/external-db-proxy", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-proxy-key": "internal-proxy-secret",
          },
          body: JSON.stringify({
            fields: "ID",
            tables: "ATENDIMENTO",
            cond: "1=1",
          }),
        });

        const res = await handleExternalDbProxyRequest(req);
        const body = await res.json();
        assertEquals(res.status, 200);
        assertEquals(body.success, true);
        assertEquals(capturedAuthHeader, "Bearer rotating-bearer-1");
      },
    );
  } finally {
    setDelphiHttpRequesterForTests(null);
  }
});

Deno.test("auth logs do not leak token or tokenapi", async () => {
  resetCachedDelphiAuthTokenForTests();
  const originalWarn = console.warn;
  const originalLog = console.log;
  const collected: string[] = [];

  const serializeArgs = (args: unknown[]) =>
    args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
  console.warn = (...args: unknown[]) => collected.push(serializeArgs(args));
  console.log = (...args: unknown[]) => collected.push(serializeArgs(args));

  try {
    await resolveDelphiBearerToken({
      authUrl: new URL("https://auth.example.com/auth?tokenapi=83FC82C5A84F90AD5"),
      requestId: "req-log-safety",
      fetcher: async () => new Response(JSON.stringify({ token: "super-secret-bearer" }), { status: 200 }),
    });
  } finally {
    console.warn = originalWarn;
    console.log = originalLog;
  }

  const merged = collected.join("\n");
  assert(!merged.includes("super-secret-bearer"));
  assert(!merged.toLowerCase().includes("tokenapi="));
});

Deno.test("auth logs include safe URL diagnostics and failure classification", async () => {
  resetCachedDelphiAuthTokenForTests();
  const originalWarn = console.warn;
  const originalLog = console.log;
  const collected: string[] = [];

  const serializeArgs = (args: unknown[]) =>
    args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
  console.warn = (...args: unknown[]) => collected.push(serializeArgs(args));
  console.log = (...args: unknown[]) => collected.push(serializeArgs(args));

  try {
    await assertRejects(
      () =>
        resolveDelphiBearerToken({
          authUrl: new URL("https://app.registrobase.com.br:32077/auth?tokenapi=83FC82C5A84F90AD5"),
          requestId: "req-log-diagnostics",
          sleepFn: async () => {},
          fetcher: async () => new Response("", { status: 200, headers: { "Content-Type": "text/plain" } }),
        }),
      Error,
      "Nao foi possivel autenticar no Delphi no momento.",
    );
  } finally {
    console.warn = originalWarn;
    console.log = originalLog;
  }

  const merged = collected.join("\n");
  assert(merged.includes("auth_url_origin"));
  assert(merged.includes("auth_url_host"));
  assert(merged.includes("auth_url_path"));
  assert(merged.includes("auth_url_has_tokenapi"));
  assert(merged.includes("body_kind"));
  assert(!merged.toLowerCase().includes("tokenapi="));
});

Deno.test("handleExternalDbProxyRequest appends DELPHI_AUTH_TOKENAPI when auth URL omits it", async () => {
  resetCachedDelphiAuthTokenForTests();
  let authUrlSeen = "";
  setDelphiHttpRequesterForTests(async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://auth.example.com")) {
      authUrlSeen = url;
      return new Response(JSON.stringify({ token: "rotating-bearer-2" }), { status: 200 });
    }

    if (url.startsWith("https://api.example.com")) {
      return new Response(
        JSON.stringify({
          RESULT: [{
            data: [{ id: 1 }],
            pageNumber: 1,
            totalPages: 1,
            totalRec: 1,
          }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  });

  try {
    await withEnv(
      {
        INTERNAL_PROXY_KEY: "internal-proxy-secret",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        DELPHI_API_URL: "https://api.example.com/query",
        DELPHI_API_TOKEN: "token-api-value",
        DELPHI_AUTH_URL: "https://auth.example.com/auth",
        DELPHI_AUTH_TOKENAPI: "tokenapi-secret-value",
        ALLOWED_PROXY_HOSTS: "api.example.com,auth.example.com",
      },
      async () => {
        const req = new Request("https://example.com/functions/v1/external-db-proxy", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-proxy-key": "internal-proxy-secret",
          },
          body: JSON.stringify({
            fields: "ID",
            tables: "ATENDIMENTO",
            cond: "1=1",
          }),
        });

        const res = await handleExternalDbProxyRequest(req);
        assertEquals(res.status, 200);
        assert(authUrlSeen.includes("tokenapi=tokenapi-secret-value"));
      },
    );
  } finally {
    setDelphiHttpRequesterForTests(null);
  }
});

Deno.test("resolveDelphiBearerToken falls back to static bearer on TLS/network failures", async () => {
  resetCachedDelphiAuthTokenForTests();

  const result = await resolveDelphiBearerToken({
    authUrl: new URL("https://app.registrobase.com.br:32077/auth?tokenapi=redacted"),
    requestId: "req-env-fallback",
    fallbackBearer: "static-fallback-bearer",
    sleepFn: async () => {},
    fetcher: async () => {
      throw new TypeError("error sending request for url (https://app.registrobase.com.br:32077/auth?tokenapi=redacted): client error (Connect): received fatal alert: HandshakeFailure");
    },
  });

  assertEquals(result.token, "static-fallback-bearer");
  assertEquals(result.authMode, "env_fallback");
});

Deno.test("requireInternalProxyKey rejects missing or invalid secrets", () => {
  const previous = Deno.env.get("INTERNAL_PROXY_KEY");
  Deno.env.set("INTERNAL_PROXY_KEY", "internal-proxy-secret");

  try {
    const missingHeaderRequest = new Request("https://example.com/functions/v1/external-db-proxy", {
      method: "POST",
    });

    assertThrows(
      () => requireInternalProxyKey(missingHeaderRequest),
      Error,
      "Missing or invalid internal proxy key.",
    );

    const invalidHeaderRequest = new Request("https://example.com/functions/v1/external-db-proxy", {
      method: "POST",
      headers: {
        "x-internal-proxy-key": "wrong-secret",
      },
    });

    assertThrows(
      () => requireInternalProxyKey(invalidHeaderRequest),
      Error,
      "Missing or invalid internal proxy key.",
    );
  } finally {
    if (previous === undefined) {
      Deno.env.delete("INTERNAL_PROXY_KEY");
    } else {
      Deno.env.set("INTERNAL_PROXY_KEY", previous);
    }
  }
});

Deno.test("assertOutboundUrlAllowed accepts hostname with port in allowlist", () => {
  const url = assertOutboundUrlAllowed(
    "https://app.registrobase.com.br:32077/auth?tokenapi=redacted",
    ["app.registrobase.com.br:32077"],
  );

  assertEquals(url.hostname, "app.registrobase.com.br");
  assertEquals(url.port, "32077");
});

Deno.test("assertOutboundUrlAllowed accepts full URL entries in allowlist", () => {
  const url = assertOutboundUrlAllowed(
    "https://app.registrobase.com.br:32077/auth?tokenapi=redacted",
    ["https://app.registrobase.com.br:32077/auth"],
  );

  assertEquals(url.hostname, "app.registrobase.com.br");
  assertEquals(url.port, "32077");
});

Deno.test("assertOutboundUrlAllowed accepts configured target URLs even without external allowlist entries", () => {
  const target = "https://app.registrobase.com.br:32077/auth?tokenapi=redacted";
  const url = assertOutboundUrlAllowed(target, [target]);

  assertEquals(url.hostname, "app.registrobase.com.br");
  assertEquals(url.port, "32077");
});
