import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import type { OpenClawPluginApi, GatewayRequestHandlerOptions } from "openclaw/plugin-sdk";

/**
 * pty-broadcast plugin
 *
 * Intercepts @lydell/node-pty (a CJS module shared with the gateway) to capture
 * PTY lifecycle and data events, then broadcasts them to WebSocket clients.
 *
 * The before_tool_call plugin hook is used to capture agent context (agentId,
 * sessionKey) just before each tool call. That metadata is then consumed by the
 * patched pty.spawn() to associate the resulting PTY process with the correct agent.
 *
 * Gateway methods:
 *   pty.subscribe   — activate PTY event broadcasting
 *   pty.input       — send stdin data to a running PTY process
 *   pty.kill        — terminate a running PTY process
 *   pty.list        — list active PTY processes
 */

interface PtyMeta {
  runId: string;
  sessionId: string;
  backendId: string;
  label: string;
}

interface ActiveRun {
  meta: PtyMeta;
  pid?: number;
  stdin?: {
    write: (data: string, cb?: (err?: Error | null) => void) => void;
    end: () => void;
  };
  cancel: (reason?: string) => void;
  resize: (cols: number, rows: number) => void;
}

const ptyBus = new EventEmitter();
ptyBus.setMaxListeners(200);

/** Active PTY runs, keyed by runId. */
const activeRuns = new Map<string, ActiveRun>();

/**
 * Latest agent context captured by the before_tool_call hook.
 * Consumed (and reset to null) when the next PTY is spawned.
 * Single-slot is sufficient for sequential agent tool calls.
 */
let pendingMeta: { agentId: string; sessionKey: string } | null = null;

let ptyWrapped = false;
let runCounter = 0;

/**
 * Patch @lydell/node-pty.spawn (a CJS module shared with the gateway).
 * Because it is CommonJS, require() and the gateway's import() reference the
 * same module.exports object — patching spawn here affects all callers.
 */
async function wrapNodePty() {
  if (ptyWrapped) return;
  ptyWrapped = true;

  const require = createRequire(import.meta.url);
  const ptyModule = require("@lydell/node-pty");

  if (!ptyModule || typeof ptyModule.spawn !== "function") {
    console.error("[pty-broadcast] @lydell/node-pty.spawn not found — cannot intercept PTY spawns");
    return;
  }

  const originalSpawn = ptyModule.spawn.bind(ptyModule);

  ptyModule.spawn = function (file: string, args: string[] | string, opts: any) {
    // Consume the agent context captured by the before_tool_call hook.
    const captured = pendingMeta;
    pendingMeta = null;

    const runId = `pty-${++runCounter}-${Date.now()}`;
    const meta: PtyMeta = {
      runId,
      sessionId: captured?.sessionKey ?? "",
      backendId: captured?.agentId ?? "exec-host",
      label: captured?.agentId ?? String(file),
    };

    const ptyHandle = originalSpawn(file, args, opts);

    const activeRun: ActiveRun = {
      meta,
      pid: ptyHandle.pid,
      stdin: {
        write: (data: string, cb?: (err?: Error | null) => void) => {
          try {
            ptyHandle.write(data);
            cb?.(null);
          } catch (err) {
            cb?.(err as Error);
          }
        },
        end: () => {
          try {
            ptyHandle.write("\x04"); // Ctrl+D / EOF
          } catch {
            /* ignore */
          }
        },
      },
      cancel: () => {
        try {
          ptyHandle.kill();
        } catch {
          /* ignore */
        }
      },
      resize: (cols: number, rows: number) => {
        try {
          ptyHandle.resize(cols, rows);
        } catch {
          /* ignore */
        }
      },
    };

    activeRuns.set(runId, activeRun);
    const command = Array.isArray(args)
      ? [file, ...args].join(" ")
      : `${file} ${args ?? ""}`.trim();
    ptyBus.emit("started", { ...meta, pid: ptyHandle.pid, command });

    ptyHandle.onData((data: string) => {
      ptyBus.emit("data", { ...meta, data: data.toString() });
    });

    ptyHandle.onExit(() => {
      activeRuns.delete(runId);
      ptyBus.emit("exited", { ...meta, pid: ptyHandle.pid });
    });

    console.log(
      `[pty-broadcast] PTY spawned: runId=${runId} backendId=${meta.backendId} pid=${ptyHandle.pid} file=${file}`,
    );

    return ptyHandle;
  };

  console.log("[pty-broadcast] @lydell/node-pty.spawn intercepted successfully");
}

export default function register(api: OpenClawPluginApi) {
  let broadcast: ((event: string, payload: unknown, opts?: any) => void) | null = null;

  function activateBroadcast(broadcastFn: typeof broadcast) {
    if (broadcast) return;
    broadcast = broadcastFn;

    ptyBus.on("started", (evt) => broadcast!("pty.started", evt));
    ptyBus.on("data", (evt) => broadcast!("pty.data", evt, { dropIfSlow: true }));
    ptyBus.on("exited", (evt) => broadcast!("pty.exited", evt));
  }

  // Capture agent context before each tool call so the pty.spawn wrapper can
  // associate the resulting PTY process with the correct agent/session.
  api.on("before_tool_call", (_event, ctx) => {
    if (ctx.agentId) {
      pendingMeta = {
        agentId: ctx.agentId,
        sessionKey: ctx.sessionKey ?? ctx.agentId,
      };
    }
  });

  // Activate broadcasting and intercept @lydell/node-pty.
  api.registerGatewayMethod(
    "pty.subscribe",
    async ({ respond, context }: GatewayRequestHandlerOptions) => {
      activateBroadcast(context.broadcast);
      await wrapNodePty();
      respond(true, { subscribed: true });
    },
  );

  // Send stdin data to a running PTY process.
  // params: { runId: string, data: string }
  api.registerGatewayMethod("pty.input", ({ params, respond }: GatewayRequestHandlerOptions) => {
    const runId = params.runId as string | undefined;
    const data = params.data as string | undefined;

    if (!runId || typeof data !== "string") {
      respond(false, undefined, { code: "INVALID_REQUEST", message: "runId and data required" });
      return;
    }

    const run = activeRuns.get(runId);
    if (!run) {
      respond(false, undefined, { code: "NOT_FOUND", message: `no active PTY run: ${runId}` });
      return;
    }

    if (!run.stdin) {
      respond(false, undefined, { code: "UNAVAILABLE", message: "PTY has no stdin" });
      return;
    }

    run.stdin.write(data, (err) => {
      if (err) {
        respond(false, undefined, { code: "UNAVAILABLE", message: err.message });
      } else {
        respond(true, { written: true });
      }
    });
  });

  // Terminate a running PTY process.
  // params: { runId: string }
  api.registerGatewayMethod("pty.kill", ({ params, respond }: GatewayRequestHandlerOptions) => {
    const runId = params.runId as string | undefined;

    if (!runId) {
      respond(false, undefined, { code: "INVALID_REQUEST", message: "runId required" });
      return;
    }

    const run = activeRuns.get(runId);
    if (!run) {
      respond(false, undefined, { code: "NOT_FOUND", message: `no active PTY run: ${runId}` });
      return;
    }

    run.cancel("manual-cancel");
    respond(true, { killed: true, runId });
  });

  // List active PTY processes.
  api.registerGatewayMethod("pty.list", ({ respond }: GatewayRequestHandlerOptions) => {
    const runs = Array.from(activeRuns.values()).map((r) => ({
      runId: r.meta.runId,
      sessionId: r.meta.sessionId,
      backendId: r.meta.backendId,
      label: r.meta.label,
      pid: r.pid,
      hasStdin: Boolean(r.stdin),
    }));
    respond(true, { runs });
  });

  // Resize all active PTY processes to match the client terminal dimensions.
  // params: { cols: number, rows: number }
  api.registerGatewayMethod("pty.resize", ({ params, respond }: GatewayRequestHandlerOptions) => {
    const cols = params.cols as number | undefined;
    const rows = params.rows as number | undefined;

    if (typeof cols !== "number" || typeof rows !== "number" || cols < 1 || rows < 1) {
      respond(false, undefined, {
        code: "INVALID_REQUEST",
        message: "cols and rows must be positive numbers",
      });
      return;
    }

    let resized = 0;
    for (const run of activeRuns.values()) {
      run.resize(cols, rows);
      resized++;
    }

    respond(true, { resized, cols, rows });
  });
}
