import http from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { handleChatRequest, handleChatTranscribeRequest } from "./index.ts";
import { createCorsHeaders } from "../_shared/security.ts";

function normalizeEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function env(name: string, fallback = ""): string {
  const processValue = typeof process !== "undefined" ? process.env?.[name] : undefined;
  if (typeof processValue === "string" && processValue.trim()) {
    return normalizeEnvValue(processValue);
  }

  const denoRuntime = globalThis as typeof globalThis & {
    Deno?: {
      env?: {
        get(name: string): string | undefined;
      };
    };
  };
  const denoValue = typeof denoRuntime.Deno?.env?.get === "function" ? denoRuntime.Deno.env.get(name) : undefined;
  if (typeof denoValue === "string" && denoValue.trim()) {
    return normalizeEnvValue(denoValue);
  }

  return fallback;
}

function toRequestHeaders(headers: http.IncomingHttpHeaders): Headers {
  const requestHeaders = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "undefined") {
      continue;
    }

    if (Array.isArray(value)) {
      requestHeaders.set(key, value.join(", "));
      continue;
    }

    requestHeaders.set(key, String(value));
  }

  return requestHeaders;
}

function toHeaderRecord(headers: HeadersInit): Record<string, string> {
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  if (headers instanceof Headers) {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }

  return headers;
}

function buildWebRequest(req: http.IncomingMessage, port: number): Request {
  const host = typeof req.headers.host === "string" && req.headers.host.trim() ? req.headers.host.trim() : `127.0.0.1:${port}`;
  const url = new URL(req.url || "/", `http://${host}`);
  const headers = toRequestHeaders(req.headers);
  const method = req.method || "GET";
  const hasBody = method !== "GET" && method !== "HEAD";

  if (!hasBody) {
    return new Request(url, { method, headers });
  }

  return new Request(url, {
    method,
    headers,
    body: Readable.toWeb(req),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

async function writeWebResponse(res: http.ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, toHeaderRecord(response.headers));

  if (!response.body) {
    const bodyText = await response.text();
    res.end(bodyText);
    return;
  }

  const stream = Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>);
  stream.on("error", (error) => {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
    }
    if (!res.writableEnded) {
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Internal stream error." }));
    }
  });

  stream.pipe(res);
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse, port: number): Promise<void> {
  const method = req.method || "GET";
  const pathname = new URL(req.url || "/", `http://127.0.0.1:${port}`).pathname;

  if (method === "GET" && pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
    res.end(JSON.stringify({ status: "ok", service: "chat-proxy" }));
    return;
  }

  if (method === "OPTIONS") {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : null;
    res.writeHead(204, {
      ...toHeaderRecord(createCorsHeaders(origin)),
      "Cache-Control": "no-cache",
    });
    res.end();
    return;
  }

  const allowedChatPaths = new Set(["/chat", "/api/chat"]);
  const allowedTranscribePaths = new Set(["/chat/transcribe", "/api/chat/transcribe"]);
  if (!allowedChatPaths.has(pathname) && !allowedTranscribePaths.has(pathname)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found." }));
    return;
  }

  const webRequest = buildWebRequest(req, port);
  const webResponse = allowedTranscribePaths.has(pathname)
    ? await handleChatTranscribeRequest(webRequest)
    : await handleChatRequest(webRequest);
  await writeWebResponse(res, webResponse);
}

const port = Number(env("CHAT_PROXY_PORT", "8789"));

const server = http.createServer((req, res) => {
  void handleRequest(req, res, port).catch((error) => {
    const message = error instanceof Error ? error.message : "Internal server error.";
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
    }
    if (!res.writableEnded) {
      res.end(JSON.stringify({ error: message }));
    }
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[chat-proxy] listening on 0.0.0.0:${port}`);
});
