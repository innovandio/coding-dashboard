import WebSocket from "ws";
import { getPool } from "./db";
import { getEventBus, type BusEvent } from "./event-bus";
import { initGsdWatchers } from "./gsd-watcher";
import type {
  ConnectionState,
  GatewayRequest,
} from "./gateway-protocol";

interface PendingRequest {
  resolve: (payload: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface IngestorState {
  connectionState: ConnectionState;
  lastTickAt: number | null;
  connectedSince: number | null;
  reconnectAttempts: number;
  agentIds: Set<string>;
  ws: WebSocket | null;
  seq: number;
  pendingRequests: Map<string, PendingRequest>;
}

// Cache: sessionKey -> { projectId, sessionId }
const sessionKeyCache = new Map<string, { projectId: string; sessionId: string }>();

const globalForIngestor = globalThis as unknown as {
  ingestorStarted?: boolean;
  ingestorState?: IngestorState;
};

export function getIngestorState(): {
  connectionState: ConnectionState;
  lastTickAt: number | null;
  tickAgeMs: number | null;
  connectedSince: number | null;
  reconnectAttempts: number;
  agentIds: string[];
} {
  const s = globalForIngestor.ingestorState;
  if (!s) {
    return {
      connectionState: "disconnected",
      lastTickAt: null,
      tickAgeMs: null,
      connectedSince: null,
      reconnectAttempts: 0,
      agentIds: [],
    };
  }
  // Lazily fetch agents if connected but list is empty
  if (s.connectionState === "connected" && s.agentIds.size === 0) {
    refreshAgentIds(s);
  }

  return {
    connectionState: s.connectionState,
    lastTickAt: s.lastTickAt,
    tickAgeMs: s.lastTickAt ? Date.now() - s.lastTickAt : null,
    connectedSince: s.connectedSince,
    reconnectAttempts: s.reconnectAttempts,
    agentIds: Array.from(s.agentIds),
  };
}

let agentRefreshInFlight = false;

function refreshAgentIds(s: IngestorState) {
  if (agentRefreshInFlight) return;
  agentRefreshInFlight = true;
  sendGatewayRequest("agents.list").then((payload) => {
    const agents = (payload as { agents?: Array<{ id: string }> }).agents;
    if (agents) {
      for (const a of agents) {
        s.agentIds.add(a.id);
      }
    }
  }).catch(() => {}).finally(() => {
    agentRefreshInFlight = false;
  });
}

export function sendGatewayRequest(
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = 10000
): Promise<Record<string, unknown>> {
  const state = globalForIngestor.ingestorState;
  if (!state || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("Gateway not connected"));
  }

  const id = String(++state.seq);
  const msg: GatewayRequest = { type: "req", id, method, params };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pendingRequests.delete(id);
      reject(new Error(`Gateway request ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    state.pendingRequests.set(id, { resolve, reject, timer });
    state.ws!.send(JSON.stringify(msg));
  });
}

export async function refreshGsdWatchers() {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, workspace_path FROM projects WHERE workspace_path IS NOT NULL`
    );
    await initGsdWatchers(result.rows);
  } catch (err) {
    console.error("[ingestor] Failed to refresh GSD watchers:", err);
  }
}

export function startIngestor() {
  if (globalForIngestor.ingestorStarted) return;
  globalForIngestor.ingestorStarted = true;

  const state: IngestorState = {
    connectionState: "disconnected",
    lastTickAt: null,
    connectedSince: null,
    reconnectAttempts: 0,
    agentIds: new Set(),
    ws: null,
    seq: 0,
    pendingRequests: new Map(),
  };
  globalForIngestor.ingestorState = state;

  const gatewayUrl = process.env.GATEWAY_WS_URL;
  const gatewayToken = process.env.GATEWAY_TOKEN;

  if (!gatewayUrl || !gatewayToken) {
    console.error("[ingestor] Missing GATEWAY_WS_URL or GATEWAY_TOKEN");
    return;
  }

  const pool = getPool();
  const bus = getEventBus();

  function connect() {
    state.connectionState = "connecting";
    console.log(`[ingestor] Connecting to ${gatewayUrl}`);

    const ws = new WebSocket(gatewayUrl!);
    state.ws = ws;

    const sendReq = (method: string, params?: Record<string, unknown>) => {
      const msg: GatewayRequest = {
        type: "req",
        id: String(++state.seq),
        method,
        params,
      };
      ws.send(JSON.stringify(msg));
    };

    ws.on("open", () => {
      state.connectionState = "authenticating";
      console.log("[ingestor] WebSocket open, waiting for challenge...");
    });

    ws.on("message", async (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }

      // Handle challenge-response auth flow
      if (msg.type === "event" && msg.event === "connect.challenge") {
        sendReq("connect", {
          minProtocol: 3,
          maxProtocol: 3,
          role: "operator",
          scopes: ["operator.admin"],
          client: {
            id: "cli",
            version: "1.0.0",
            platform: "node",
            mode: "cli",
          },
          auth: { token: gatewayToken },
        });
        return;
      }

      // Handle responses (both connect response and sendGatewayRequest responses)
      if (msg.type === "res") {
        const resId = msg.id as string;
        const pending = state.pendingRequests.get(resId);

        if (pending) {
          // This is a response to a sendGatewayRequest call
          state.pendingRequests.delete(resId);
          clearTimeout(pending.timer);

          if (msg.ok) {
            pending.resolve((msg.payload as Record<string, unknown>) ?? {});
          } else {
            const error = msg.error as Record<string, unknown> | undefined;
            pending.reject(new Error(String(error?.message ?? "Gateway request failed")));
          }
          return;
        }

        // Connect response (no pending entry — it was sent via sendReq directly)
        if (msg.ok) {
          state.connectionState = "connected";
          state.connectedSince = Date.now();
          state.reconnectAttempts = 0;
          console.log("[ingestor] Connected to Gateway");

          const resPayload = msg.payload as Record<string, unknown> | undefined;
          if (resPayload) {
            const agents = resPayload.agents as Array<{ id: string }> | undefined;
            if (agents) {
              for (const a of agents) {
                state.agentIds.add(a.id);
              }
            }
          }

          // Actively fetch agents list from Gateway
          sendGatewayRequest("agents.list").then((payload) => {
            const agents = (payload as { agents?: Array<{ id: string }> }).agents;
            if (agents) {
              for (const a of agents) {
                state.agentIds.add(a.id);
              }
              console.log("[ingestor] Fetched agents:", Array.from(state.agentIds));
            }
          }).catch((err) => {
            console.error("[ingestor] agents.list failed:", err.message);
          });

          // Start GSD file watchers for all projects with workspace paths
          refreshGsdWatchers();
        } else {
          const error = msg.error as Record<string, unknown> | undefined;
          console.error("[ingestor] Connect rejected:", error?.message ?? msg);
        }
        return;
      }

      // Handle regular events (after connected)
      if (msg.type === "event") {
        const eventName = msg.event as string;
        const payload = (msg.payload ?? msg) as Record<string, unknown>;

        let agentId =
          (payload.agentId as string) ??
          (payload.agent_id as string) ??
          null;
        let sessionId =
          (payload.sessionId as string) ??
          (payload.session_id as string) ??
          null;

        if (agentId) state.agentIds.add(agentId);
        if (eventName === "tick") state.lastTickAt = Date.now();

        // Resolve sessionKey to projectId/sessionId for chat and agent events
        if ((eventName === "chat" || eventName === "agent") && payload.sessionKey) {
          const sessionKey = payload.sessionKey as string;
          const resolved = await resolveSessionKey(sessionKey);
          if (resolved) {
            agentId = agentId ?? resolved.projectId; // agentId = projectId for auto-created projects
            sessionId = sessionId ?? resolved.sessionId;
          }
        }

        // Auto-create project/session if new
        const projectId = agentId ? await ensureProject(agentId) : null;
        if (sessionId && projectId) {
          await ensureSession(sessionId, projectId);
        }

        await insertEvent(
          projectId,
          sessionId,
          agentId,
          "gateway",
          eventName,
          payload
        );
      }
    });

    ws.on("close", () => {
      state.connectionState = "reconnecting";
      state.connectedSince = null;
      state.ws = null;

      // Reject all pending requests
      for (const [id, pending] of state.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Gateway connection closed"));
      }
      state.pendingRequests.clear();

      scheduleReconnect();
    });

    ws.on("error", (err) => {
      console.error("[ingestor] WS error:", err.message);
      try { ws.close(); } catch { /* ignore */ }
    });

    async function resolveSessionKey(
      sessionKey: string
    ): Promise<{ projectId: string; sessionId: string } | null> {
      const cached = sessionKeyCache.get(sessionKey);
      if (cached) return cached;

      try {
        const result = await pool.query(
          `SELECT id, project_id FROM sessions WHERE session_key = $1 LIMIT 1`,
          [sessionKey]
        );
        if (result.rows.length > 0) {
          const entry = {
            projectId: result.rows[0].project_id,
            sessionId: result.rows[0].id,
          };
          sessionKeyCache.set(sessionKey, entry);
          return entry;
        }
      } catch (err) {
        console.error("[ingestor] resolveSessionKey error:", err);
      }
      return null;
    }

    async function insertEvent(
      projectId: string | null,
      sessionId: string | null,
      agentId: string | null,
      source: string,
      eventType: string,
      payload: unknown
    ) {
      try {
        const result = await pool.query(
          `INSERT INTO events (project_id, session_id, agent_id, source, event_type, payload)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, created_at`,
          [projectId, sessionId, agentId, source, eventType, JSON.stringify(payload)]
        );
        const row = result.rows[0];
        const busEvent: BusEvent = {
          id: row.id,
          project_id: projectId,
          session_id: sessionId,
          agent_id: agentId,
          source,
          event_type: eventType,
          payload: payload as Record<string, unknown>,
          created_at: row.created_at,
        };
        bus.emit("event", busEvent);
      } catch (err) {
        console.error("[ingestor] DB insert error:", err);
      }
    }

    async function ensureProject(agentId: string): Promise<string> {
      try {
        const existing = await pool.query(
          `SELECT id FROM projects WHERE agent_id = $1`,
          [agentId]
        );
        if (existing.rows.length > 0) return existing.rows[0].id;

        const id = agentId;
        await pool.query(
          `INSERT INTO projects (id, agent_id, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
          [id, agentId, agentId]
        );
        return id;
      } catch (err) {
        console.error("[ingestor] ensureProject error:", err);
        return agentId;
      }
    }

    async function ensureSession(
      sessionId: string,
      projectId: string
    ): Promise<void> {
      try {
        const existing = await pool.query(
          `SELECT id FROM sessions WHERE id = $1`,
          [sessionId]
        );
        if (existing.rows.length > 0) return;

        await pool.query(
          `INSERT INTO sessions (id, project_id) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
          [sessionId, projectId]
        );
      } catch (err) {
        console.error("[ingestor] ensureSession error:", err);
      }
    }
  }

  function scheduleReconnect() {
    state.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts - 1), 30000);
    console.log(
      `[ingestor] Reconnecting in ${delay}ms (attempt ${state.reconnectAttempts})`
    );
    setTimeout(connect, delay);
  }

  connect();
}
