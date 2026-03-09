interface GatewayClientOptions {
  dashboardUrl: string;
  authCookie: string;
}

interface CreateProjectInput {
  agentId: string;
  name: string;
  workspace: string;
}

interface SessionInfo {
  sessionId: string;
  sessionKey: string;
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

async function parseNdjsonDone(response: Response, endpoint: string): Promise<void> {
  if (!response.body) {
    throw new Error(`No stream body received from ${endpoint}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneReceived = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const data = JSON.parse(line) as {
        done?: boolean;
        success?: boolean;
        error?: string;
      };

      if (!data.done) continue;
      doneReceived = true;
      if (!data.success) {
        throw new Error(data.error ?? `${endpoint} failed`);
      }
      return;
    }
  }

  if (!doneReceived) {
    throw new Error(`${endpoint} stream ended without done event`);
  }
}

function parseSseDataChunks(chunk: string): string[] {
  const blocks = chunk.split("\n\n");
  return blocks
    .map((block) =>
      block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join(""),
    )
    .filter(Boolean);
}

export class GatewayClient {
  private readonly dashboardUrl: string;
  private readonly authCookie: string;

  constructor(options: GatewayClientOptions) {
    this.dashboardUrl = normalizeBaseUrl(options.dashboardUrl);
    this.authCookie = options.authCookie.trim();
    if (!this.authCookie) {
      throw new Error("GatewayClient requires a non-empty auth cookie");
    }
  }

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    if (!headers.has("Cookie")) {
      headers.set("Cookie", this.authCookie);
    }
    if (init?.body != null && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await globalThis.fetch(`${this.dashboardUrl}${path}`, {
      ...init,
      headers,
    });
    return response;
  }

  async checkHealth(): Promise<void> {
    const response = await this.fetch("/api/health", { method: "GET" });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`/api/health failed (${response.status}): ${body}`);
    }

    const data = (await response.json().catch(() => ({}))) as {
      connectionState?: string;
      needsSetup?: boolean;
      needsClaudeLogin?: boolean;
    };

    if (data.needsSetup) {
      throw new Error("Dashboard health reports setup incomplete (needsSetup=true)");
    }

    if (data.needsClaudeLogin) {
      throw new Error("Dashboard health reports Claude login incomplete (needsClaudeLogin=true)");
    }

    if (data.connectionState && data.connectionState !== "connected") {
      throw new Error(
        `Dashboard health reports gateway state '${data.connectionState}', expected 'connected'`,
      );
    }
  }

  async createProject(input: CreateProjectInput): Promise<void> {
    const response = await this.fetch("/api/projects/create", {
      method: "POST",
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`/api/projects/create failed (${response.status}): ${body}`);
    }

    await parseNdjsonDone(response, "/api/projects/create");
  }

  async createSession(projectId: string): Promise<SessionInfo> {
    const response = await this.fetch("/api/chat/session", {
      method: "POST",
      body: JSON.stringify({ projectId }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`/api/chat/session failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as Partial<SessionInfo> & { error?: string };
    if (data.error || !data.sessionId || !data.sessionKey) {
      throw new Error(data.error ?? "Invalid session response");
    }
    return { sessionId: data.sessionId, sessionKey: data.sessionKey };
  }

  async sendMessage(input: SessionInfo & { message: string }): Promise<void> {
    const response = await this.fetch("/api/chat/send", {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`/api/chat/send failed (${response.status}): ${body}`);
    }
  }

  async abortSession(sessionKey: string): Promise<void> {
    const response = await this.fetch("/api/chat/abort", {
      method: "POST",
      body: JSON.stringify({ sessionKey }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`/api/chat/abort failed (${response.status}): ${body}`);
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    const response = await this.fetch(`/api/projects/${projectId}/delete`, {
      method: "POST",
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`/api/projects/${projectId}/delete failed (${response.status}): ${body}`);
    }

    await parseNdjsonDone(response, `/api/projects/${projectId}/delete`);
  }

  async waitForLifecycleEnd(input: { projectId: string; timeoutMs: number }): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

    try {
      const response = await this.fetch(
        `/api/events/stream?project_id=${encodeURIComponent(input.projectId)}`,
        {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
          },
          signal: controller.signal,
        },
      );

      if (!response.ok || !response.body) {
        const body = await response.text().catch(() => "");
        throw new Error(`/api/events/stream failed (${response.status}): ${body}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          throw new Error("Event stream ended before lifecycle completion");
        }

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const payloadStrings = parseSseDataChunks(chunk);
          for (const payloadStr of payloadStrings) {
            const event = JSON.parse(payloadStr) as {
              event_type?: string;
              payload?: Record<string, unknown>;
            };

            if (event.event_type !== "agent") continue;

            const payload = event.payload ?? {};
            const stream = payload.stream as string | undefined;
            if (stream !== "lifecycle") continue;

            const data = (payload.data as Record<string, unknown> | undefined) ?? payload;
            const phase = (data.phase ?? data.event ?? data.state) as string | undefined;
            if (phase === "end" || phase === "ended" || phase === "done" || phase === "complete") {
              return;
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(`Timed out waiting for lifecycle end after ${input.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }
}
