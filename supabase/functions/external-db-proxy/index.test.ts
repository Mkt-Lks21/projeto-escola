import { assertEquals, assertThrows } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { requireInternalProxyKey } from "./index.ts";

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
