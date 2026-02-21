import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import WebSocket from "ws";
import { getPool } from "./db";
import { getEventBus, nextSyntheticId, type BusEvent } from "./event-bus";
import { initGsdWatchers } from "./gsd-watcher";

const execFileAsync = promisify(execFile);
import type {
  ConnectionState,
  GatewayRequest,
} from "./gateway-protocol";

// --- Device identity for gateway auth (Ed25519) ---

interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" }) as Buffer;
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function loadOrCreateDeviceIdentity(): DeviceIdentity {
  const filePath = path.join(process.cwd(), ".data", "device-identity.json");

  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed?.version === 1 && parsed.deviceId && parsed.publicKeyPem && parsed.privateKeyPem) {
        return parsed;
      }
    }
  } catch { /* regenerate */ }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const rawKey = derivePublicKeyRaw(publicKeyPem);
  const deviceId = crypto.createHash("sha256").update(rawKey).digest("hex");

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify({ version: 1, deviceId, publicKeyPem, privateKeyPem, createdAtMs: Date.now() }, null, 2) + "\n",
    { mode: 0o600 }
  );
  return { deviceId, publicKeyPem, privateKeyPem };
}

function buildDeviceConnect(identity: DeviceIdentity, scopes: string[], token: string, nonce?: string) {
  const signedAt = Date.now();
  const version = nonce ? "v2" : "v1";
  const parts = [
    version, identity.deviceId, "gateway-client", "backend", "operator",
    scopes.join(","), String(signedAt), token,
  ];
  if (version === "v2") parts.push(nonce ?? "");
  const payload = parts.join("|");

  const privateKey = crypto.createPrivateKey(identity.privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), privateKey);

  return {
    id: identity.deviceId,
    publicKey: base64UrlEncode(derivePublicKeyRaw(identity.publicKeyPem)),
    signature: base64UrlEncode(sig),
    signedAt,
    ...(nonce ? { nonce } : {}),
  };
}

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
  needsSetup: boolean;
  needsSetupCheckedAt: number;
  needsClaudeLogin: boolean;
  needsClaudeLoginCheckedAt: number;
}

// Cache: sessionKey -> { projectId, sessionId, agentId }
const sessionKeyCache = new Map<
  string,
  { projectId: string; sessionId: string; agentId: string }
>();

// --- needsSetup detection ---

let needsSetupCheckInFlight = false;

/**
 * Check if openclaw.json exists inside the container.
 * The file is only created by the setup wizard (via `openclaw config set`
 * and plugin enablement), so its absence indicates setup is still needed.
 * This correctly detects volume resets even when GATEWAY_TOKEN persists
 * in the host's .env.
 * Fire-and-forget — updates state in place. Cached for 5s.
 */
function checkNeedsSetup(state: IngestorState): void {
  if (needsSetupCheckInFlight) return;
  if (Date.now() - state.needsSetupCheckedAt < 5000) return;

  needsSetupCheckInFlight = true;
  execFileAsync("docker", [
    "compose", "exec", "-T", "openclaw-gateway",
    "sh", "-c", "test -f $HOME/.openclaw/openclaw.json",
  ])
    .then(() => {
      state.needsSetup = false;
    })
    .catch(() => {
      state.needsSetup = true;
    })
    .finally(() => {
      state.needsSetupCheckedAt = Date.now();
      needsSetupCheckInFlight = false;
    });
}

/** Called from setup-process.ts after successful setup to bust the cache. */
export function invalidateNeedsSetupCache(): void {
  const s = globalForIngestor.ingestorState;
  if (s) {
    s.needsSetupCheckedAt = 0;
    s.needsSetup = false;
  }
}

/**
 * Force-restart the ingestor connection.
 * Tears down the current WebSocket and resets the singleton so startIngestor()
 * can be called again with fresh env vars and a new device identity.
 */
export function restartIngestor(): void {
  const s = globalForIngestor.ingestorState;
  if (s?.ws) {
    try { s.ws.close(); } catch { /* ignore */ }
    s.ws = null;
  }
  // Clear pending requests
  if (s) {
    for (const [, pending] of s.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Ingestor restarting"));
    }
    s.pendingRequests.clear();
  }
  globalForIngestor.ingestorStarted = false;
  globalForIngestor.ingestorState = undefined;
  console.log("[ingestor] Force-restart: cleared state, will re-init on next startIngestor()");
  startIngestor();
}

// --- needsClaudeLogin detection ---

let claudeLoginCheckInFlight = false;

/**
 * Check if Claude Code has credentials inside the container.
 * On Linux, Claude Code stores credentials in plaintext at
 * $HOME/.claude/.credentials.json (the "plaintext" backend).
 * We check for this file via `docker compose exec test -f`.
 * Fire-and-forget — updates state in place, next health poll returns the result.
 * Only runs when setup is complete. Cached for 10s.
 * Uses docker exec (not the WS connection) so it works even while reconnecting.
 */
function checkNeedsClaudeLogin(state: IngestorState): void {
  if (claudeLoginCheckInFlight) return;
  if (Date.now() - state.needsClaudeLoginCheckedAt < 10000) return;
  if (state.needsSetup) return;

  claudeLoginCheckInFlight = true;
  execFileAsync("docker", [
    "compose", "exec", "-T", "openclaw-gateway",
    "sh", "-c", "test -f $HOME/.claude/.credentials.json",
  ])
    .then(() => {
      // File exists — credentials present
      state.needsClaudeLogin = false;
    })
    .catch(() => {
      // File missing or container issue — needs login
      state.needsClaudeLogin = true;
    })
    .finally(() => {
      state.needsClaudeLoginCheckedAt = Date.now();
      claudeLoginCheckInFlight = false;
    });
}

/** Called from claude-login-process.ts after successful login to bust the cache. */
export function invalidateNeedsClaudeLoginCache(): void {
  const s = globalForIngestor.ingestorState;
  if (s) {
    s.needsClaudeLoginCheckedAt = 0;
    s.needsClaudeLogin = false;
  }
}

function shouldEmit(eventType: string, payload: Record<string, unknown>): boolean {
  if (eventType === "tick") return false;
  if (
    eventType === "agent" &&
    (payload.data as Record<string, unknown> | undefined)?.text ===
      "HEARTBEAT_OK"
  )
    return false;
  return true;
}

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
  needsSetup: boolean;
  needsClaudeLogin: boolean;
} {
  const s = globalForIngestor.ingestorState;
  if (!s) {
    // No ingestor yet — can't check container volumes, return defaults
    return {
      connectionState: "disconnected",
      lastTickAt: null,
      tickAgeMs: null,
      connectedSince: null,
      reconnectAttempts: 0,
      agentIds: [],
      needsSetup: false,
      needsClaudeLogin: false,
    };
  }

  // Backfill fields for state objects created before HMR reload
  if (s.needsSetupCheckedAt === undefined) {
    s.needsSetupCheckedAt = 0;
    s.needsSetup = false;
  }
  if (s.needsClaudeLoginCheckedAt === undefined) {
    s.needsClaudeLoginCheckedAt = 0;
    s.needsClaudeLogin = false;
  }

  // Lazily fetch agents if connected but list is empty
  if (s.connectionState === "connected" && s.agentIds.size === 0) {
    refreshAgentIds(s);
  }

  // Lazily check needsSetup (cached for 5s)
  checkNeedsSetup(s);

  // Lazily check needsClaudeLogin (async, cached for 10s, only after setup)
  checkNeedsClaudeLogin(s);

  return {
    connectionState: s.connectionState,
    lastTickAt: s.lastTickAt,
    tickAgeMs: s.lastTickAt ? Date.now() - s.lastTickAt : null,
    connectedSince: s.connectedSince,
    reconnectAttempts: s.reconnectAttempts,
    agentIds: Array.from(s.agentIds),
    needsSetup: s.needsSetup,
    needsClaudeLogin: s.needsClaudeLogin,
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
      `SELECT id, name, workspace_path FROM projects WHERE workspace_path IS NOT NULL`
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
    needsSetup: false,
    needsSetupCheckedAt: 0,
    needsClaudeLogin: false,
    needsClaudeLoginCheckedAt: 0,
  };
  globalForIngestor.ingestorState = state;

  const gatewayUrl = process.env.GATEWAY_WS_URL;

  if (!gatewayUrl || !process.env.GATEWAY_TOKEN) {
    console.error("[ingestor] Missing GATEWAY_WS_URL or GATEWAY_TOKEN");
    return;
  }

  const deviceIdentity = loadOrCreateDeviceIdentity();
  const connectScopes = ["operator.admin", "operator.read", "operator.write"];
  const pool = getPool();
  const bus = getEventBus();

  function connect() {
    // Read token fresh each time — setup-process.ts updates process.env after onboard
    const gatewayToken = process.env.GATEWAY_TOKEN;
    if (!gatewayToken) {
      console.error("[ingestor] No GATEWAY_TOKEN in env, deferring reconnect");
      scheduleReconnect();
      return;
    }

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
        const challengePayload = msg.payload as Record<string, unknown> | undefined;
        const nonce = typeof challengePayload?.nonce === "string" ? challengePayload.nonce : undefined;
        sendReq("connect", {
          minProtocol: 3,
          maxProtocol: 3,
          role: "operator",
          scopes: connectScopes,
          client: {
            id: "gateway-client",
            version: "1.0.0",
            platform: "node",
            mode: "backend",
          },
          auth: { token: gatewayToken },
          device: buildDeviceConnect(deviceIdentity, connectScopes, gatewayToken!, nonce),
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

          // Activate PTY event broadcasting via the pty-broadcast plugin
          sendGatewayRequest("pty.subscribe", {}).catch((err) => {
            console.error("[ingestor] pty.subscribe failed:", err.message);
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

        // Tick: update in-memory timestamp and skip everything else
        if (eventName === "tick") {
          state.lastTickAt = Date.now();
          return;
        }

        // PTY events: resolve backendId → projectId, then forward to pty-emitter
        if (eventName.startsWith("pty.")) {
          const { getPtyEmitter } = await import("./pty-emitter");
          const backendId = payload.backendId as string | undefined;
          let projectId: string | undefined;
          if (backendId) {
            // backendId in OpenClaw maps to agent_id in our DB
            try {
              const result = await pool.query(
                `SELECT id FROM projects WHERE agent_id = $1 LIMIT 1`,
                [backendId]
              );
              projectId = result.rows[0]?.id;
            } catch { /* best effort */ }
          }
          getPtyEmitter().emit(eventName, { ...payload, projectId });
          return;
        }

        // Resolve sessionKey to projectId/sessionId for chat and agent events
        if ((eventName === "chat" || eventName === "agent") && payload.sessionKey) {
          const sessionKey = payload.sessionKey as string;
          const resolved = await resolveSessionKey(sessionKey);
          if (resolved) {
            agentId = agentId ?? resolved.agentId;
            sessionId = sessionId ?? resolved.sessionId;
          }
        }

        // Auto-create project/session if new
        const projectId = agentId ? await ensureProject(agentId) : null;
        if (sessionId && projectId) {
          await ensureSession(sessionId, projectId);
        }

        await handleEvent(
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
    ): Promise<{ projectId: string; sessionId: string; agentId: string } | null> {
      const cached = sessionKeyCache.get(sessionKey);
      if (cached) return cached;

      try {
        const result = await pool.query(
          `SELECT s.id, s.project_id, p.agent_id
           FROM sessions s
           JOIN projects p ON p.id = s.project_id
           WHERE s.session_key = $1 LIMIT 1`,
          [sessionKey]
        );
        if (result.rows.length > 0) {
          const entry = {
            projectId: result.rows[0].project_id,
            sessionId: result.rows[0].id,
            agentId: result.rows[0].agent_id,
          };
          sessionKeyCache.set(sessionKey, entry);
          return entry;
        }
      } catch (err) {
        console.error("[ingestor] resolveSessionKey error:", err);
      }
      return null;
    }

    function handleEvent(
      projectId: string | null,
      sessionId: string | null,
      agentId: string | null,
      source: string,
      eventType: string,
      payload: unknown
    ) {
      const p = payload as Record<string, unknown>;
      if (!shouldEmit(eventType, p)) return;

      const busEvent: BusEvent = {
        id: nextSyntheticId(),
        project_id: projectId,
        session_id: sessionId,
        agent_id: agentId,
        source,
        event_type: eventType,
        payload: p,
        created_at: new Date().toISOString(),
      };
      bus.emit("event", busEvent);
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

    // After repeated failures, check if the gateway needs setup
    if (state.reconnectAttempts > 2) {
      checkNeedsSetup(state);
    }

    setTimeout(connect, delay);
  }

  connect();
}
