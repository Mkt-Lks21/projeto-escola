#!/usr/bin/env node
const baseUrl = (process.env.SMOKE_BASE_URL || `http://127.0.0.1:${process.env.WEB_HOST_PORT || "8080"}`).replace(/\/+$/, "");
const internalProxyKey = process.env.SMOKE_INTERNAL_PROXY_KEY || process.env.INTERNAL_PROXY_KEY || "";
const supabaseAccessToken = process.env.SMOKE_SUPABASE_ACCESS_TOKEN || "";
const supabasePublishableKey =
  process.env.SMOKE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

const failures = [];
const warnings = [];

function logStep(label, detail) {
  console.log(`\n==> ${label}`);
  if (detail) console.log(detail);
}

async function expectOk(name, url, options = {}, validator) {
  logStep(name, `${options.method || "GET"} ${url}`);
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch (error) {
    failures.push(`${name}: failed to read response body: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  let parsed = null;
  if (contentType.includes("application/json")) {
    try {
      parsed = JSON.parse(bodyText);
    } catch (error) {
      failures.push(`${name}: invalid JSON response: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  console.log(`status=${response.status}`);
  if (bodyText) {
    console.log(bodyText.slice(0, 800));
  }

  if (!response.ok) {
    failures.push(`${name}: expected 2xx, got ${response.status}`);
    return parsed;
  }

  if (validator) {
    const validationError = validator({ response, parsed, bodyText, contentType });
    if (validationError) {
      failures.push(`${name}: ${validationError}`);
    }
  }

  return parsed;
}

async function expectFailure(name, url, options = {}, validator) {
  logStep(name, `${options.method || "GET"} ${url}`);
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const bodyText = await response.text();
  let parsed = null;
  if (contentType.includes("application/json")) {
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = null;
    }
  }

  console.log(`status=${response.status}`);
  if (bodyText) {
    console.log(bodyText.slice(0, 800));
  }

  if (response.ok) {
    failures.push(`${name}: expected failure status, got ${response.status}`);
    return parsed;
  }

  if (validator) {
    const validationError = validator({ response, parsed, bodyText, contentType });
    if (validationError) {
      failures.push(`${name}: ${validationError}`);
    }
  }

  return parsed;
}

async function main() {
  console.log(`Hard smoke test base URL: ${baseUrl}`);

  await expectOk("Frontend root", `${baseUrl}/`, {}, ({ bodyText }) => {
    if (!/<!doctype html>|<html/i.test(bodyText)) {
      return "expected HTML response from frontend root";
    }
    return null;
  });

  await expectOk("Delphi health", `${baseUrl}/health`, {}, ({ parsed }) => {
    if (!parsed || parsed.service !== "delphi-proxy" || parsed.status !== "ok") {
      return "unexpected delphi health payload";
    }
    return null;
  });

  await expectOk("Admin health", `${baseUrl}/api/health`, {}, ({ parsed }) => {
    if (!parsed || parsed.service !== "admin-proxy" || parsed.status !== "ok") {
      return "unexpected admin health payload";
    }
    return null;
  });

  await expectOk("Chat health", `${baseUrl}/api/chat-health`, {}, ({ parsed }) => {
    if (!parsed || parsed.service !== "chat-proxy" || parsed.status !== "ok") {
      return "unexpected chat health payload";
    }
    return null;
  });

  await expectFailure("Chat rejects missing authorization", `${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "oi" }],
    }),
  }, ({ parsed, response }) => {
    if (response.status !== 401) {
      return `expected 401 when authorization is missing, got ${response.status}`;
    }
    if (!parsed || typeof parsed.error !== "string" || !/authorization/i.test(parsed.error)) {
      return "expected authorization error message";
    }
    return null;
  });

  await expectFailure("Delphi proxy rejects missing internal key", `${baseUrl}/api/external-db-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: "ID", tables: "ATENDIMENTO", cond: "1=1" }),
  }, ({ parsed, response }) => {
    if (response.status !== 500 && response.status !== 401) {
      return `expected 401/500 when internal key is missing, got ${response.status}`;
    }
    if (!parsed || typeof parsed.error !== "string" || !/internal proxy key/i.test(parsed.error)) {
      return "expected internal proxy key error message";
    }
    return null;
  });

  if (!internalProxyKey) {
    warnings.push("SMOKE_INTERNAL_PROXY_KEY not set; skipping positive Delphi proxy test.");
  } else {
    await expectOk(
      "Delphi proxy end-to-end",
      `${baseUrl}/api/external-db-proxy`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-proxy-key": internalProxyKey,
        },
        body: JSON.stringify({
          fields: "ID",
          tables: "ATENDIMENTO",
          cond: "1=1",
          order: "",
          rowspPage: 1,
          pageNumber: 1,
          empresa: 1,
          debug: true,
        }),
      },
      ({ parsed }) => {
        if (!parsed || parsed._debug !== true) {
          return "expected debug payload from Delphi proxy";
        }
        if (typeof parsed._status !== "number") {
          return "expected upstream status in debug payload";
        }
        if (parsed._status !== 200) {
          return `Delphi upstream returned ${parsed._status}. Raw: ${String(parsed._raw || "").slice(0, 300)}`;
        }
        return null;
      },
    );
  }

  if (supabaseAccessToken && supabasePublishableKey) {
    await expectOk(
      "Chat end-to-end",
      `${baseUrl}/api/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseAccessToken}`,
          apikey: supabasePublishableKey,
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Responda apenas com uma saudacao curta." }],
          sqlDebug: false,
        }),
      },
      ({ bodyText }) => {
        if (!bodyText.includes("data:")) {
          return "expected SSE data frames in chat response";
        }
        if (!bodyText.includes("[DONE]")) {
          return "expected chat stream to terminate with [DONE]";
        }
        return null;
      },
    );

    await expectOk(
      "Admin proxy test-connection",
      `${baseUrl}/api/external-db-admin`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseAccessToken}`,
          apikey: supabasePublishableKey,
        },
        body: JSON.stringify({ action: "test-connection" }),
      },
      ({ parsed }) => {
        if (!parsed || parsed.success !== true) {
          return "expected successful test-connection payload";
        }
        return null;
      },
    );
  } else {
    warnings.push("SMOKE_SUPABASE_ACCESS_TOKEN and/or SMOKE_SUPABASE_PUBLISHABLE_KEY not set; skipping admin proxy authenticated test.");
  }

  if (warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
  }

  if (failures.length > 0) {
    console.error("\nHard smoke test failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log("\nHard smoke test passed.");
}

main().catch((error) => {
  console.error("Hard smoke test crashed:", error);
  process.exit(1);
});
