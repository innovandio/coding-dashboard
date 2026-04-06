import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import { afterEach, describe, expect, test } from "vitest";
import { GatewayClient } from "./lib/gateway-client";

interface TestHttpServer {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<TestHttpServer> {
  const server: Server = createServer(handler);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve test server address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

const servers: TestHttpServer[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) await server.close();
  }
});

describe("GatewayClient", () => {
  test("handles NDJSON endpoints and lifecycle SSE completion", async () => {
    const server = await startServer((req, res) => {
      if ((req.headers.cookie ?? "") !== "session=test-cookie") {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      if (req.url === "/api/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ connectionState: "connected" }));
        return;
      }

      if (req.url === "/api/projects/create") {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.end(
          `${JSON.stringify({ step: 0, status: "success" })}\n${JSON.stringify({ done: true, success: true })}\n`,
        );
        return;
      }

      if (req.url === "/api/chat/session") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ sessionId: "s-1", sessionKey: "k-1" }));
        return;
      }

      if (req.url === "/api/chat/send") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.url?.startsWith("/api/events/stream")) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(
          `data: ${JSON.stringify({ event_type: "agent", payload: { stream: "lifecycle", data: { phase: "end" } } })}\n\n`,
        );
        res.end();
        return;
      }

      if (req.url === "/api/chat/abort") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.url === "/api/projects/proj-1/delete") {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.end(`${JSON.stringify({ done: true, success: true })}\n`);
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
    });
    servers.push(server);

    const client = new GatewayClient({
      dashboardUrl: server.baseUrl,
      authCookie: "session=test-cookie",
    });

    await client.checkHealth();
    await client.createProject({
      agentId: "proj-1",
      name: "Project",
      workspace: "/tmp/project",
    });
    const session = await client.createSession("proj-1");
    await client.sendMessage({ ...session, message: "hello" });
    await client.waitForLifecycleEnd({ projectId: "proj-1", timeoutMs: 1_000 });
    await client.abortSession(session.sessionKey);
    await client.deleteProject("proj-1");
  });

  test("times out when lifecycle end is never emitted", async () => {
    const server = await startServer((req, res) => {
      if ((req.headers.cookie ?? "") !== "session=test-cookie") {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      if (req.url?.startsWith("/api/events/stream")) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`: keepalive\n\n`);
        return;
      }

      if (req.url === "/api/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ connectionState: "connected" }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    servers.push(server);

    const client = new GatewayClient({
      dashboardUrl: server.baseUrl,
      authCookie: "session=test-cookie",
    });

    await expect(
      client.waitForLifecycleEnd({ projectId: "proj-1", timeoutMs: 50 }),
    ).rejects.toThrow("Timed out waiting for lifecycle end");
  });
});
