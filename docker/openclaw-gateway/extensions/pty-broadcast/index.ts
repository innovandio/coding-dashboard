import { EventEmitter } from "node:events";
import type {
  OpenClawPluginApi,
  GatewayRequestHandlerOptions,
} from "openclaw/plugin-sdk";

/**
 * pty-broadcast plugin
 *
 * Intercepts the process supervisor's spawn() to capture PTY lifecycle and
 * data events, then broadcasts them to WebSocket clients via the gateway.
 *
 * Also provides gateway methods for sending input to PTY processes and
 * controlling their lifecycle (kill).
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
}

const ptyBus = new EventEmitter();
ptyBus.setMaxListeners(200);

/** Active PTY runs, keyed by runId. */
const activeRuns = new Map<string, ActiveRun>();

let supervisorWrapped = false;

async function wrapSupervisor() {
  if (supervisorWrapped) return;
  supervisorWrapped = true;

  const supervisorModule = await import("/app/src/process/supervisor/index.ts");
  const supervisor = supervisorModule.getProcessSupervisor();
  const originalSpawn = supervisor.spawn.bind(supervisor);

  supervisor.spawn = async (input: any) => {
    if (input.mode !== "pty") {
      return originalSpawn(input);
    }

    const meta: PtyMeta = {
      runId: input.runId || "",
      sessionId: input.sessionId,
      backendId: input.backendId,
      label: input.backendId,
    };

    // Wrap onStdout BEFORE calling originalSpawn so the supervisor wires
    // our wrapper as the stdout listener, not the original callback.
    const origOnStdout = input.onStdout;
    input.onStdout = (chunk: string) => {
      origOnStdout?.(chunk);
      ptyBus.emit("data", { ...meta, data: chunk });
    };

    const run = await originalSpawn(input);

    meta.runId = run.runId;

    const activeRun: ActiveRun = {
      meta,
      pid: run.pid,
      stdin: run.stdin,
      cancel: run.cancel,
    };
    activeRuns.set(run.runId, activeRun);

    ptyBus.emit("started", { ...meta, pid: run.pid });

    run.wait().then(() => {
      activeRuns.delete(run.runId);
      ptyBus.emit("exited", { ...meta, pid: run.pid });
    });

    return run;
  };
}

export default function register(api: OpenClawPluginApi) {
  let broadcast: ((event: string, payload: unknown, opts?: any) => void) | null = null;

  function activateBroadcast(broadcastFn: typeof broadcast) {
    if (broadcast) return;
    broadcast = broadcastFn;

    ptyBus.on("started", (evt) => broadcast!("pty.started", evt, { dropIfSlow: true }));
    ptyBus.on("data", (evt) => broadcast!("pty.data", evt, { dropIfSlow: true }));
    ptyBus.on("exited", (evt) => broadcast!("pty.exited", evt, { dropIfSlow: true }));
  }

  // Activate broadcasting and wrap the supervisor.
  api.registerGatewayMethod(
    "pty.subscribe",
    async ({ respond, context }: GatewayRequestHandlerOptions) => {
      activateBroadcast(context.broadcast);
      await wrapSupervisor();
      respond(true, { subscribed: true });
    },
  );

  // Send stdin data to a running PTY process.
  // params: { runId: string, data: string }
  api.registerGatewayMethod(
    "pty.input",
    ({ params, respond }: GatewayRequestHandlerOptions) => {
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
    },
  );

  // Terminate a running PTY process.
  // params: { runId: string }
  api.registerGatewayMethod(
    "pty.kill",
    ({ params, respond }: GatewayRequestHandlerOptions) => {
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
    },
  );

  // List active PTY processes.
  api.registerGatewayMethod(
    "pty.list",
    ({ respond }: GatewayRequestHandlerOptions) => {
      const runs = Array.from(activeRuns.values()).map((r) => ({
        runId: r.meta.runId,
        sessionId: r.meta.sessionId,
        backendId: r.meta.backendId,
        label: r.meta.label,
        pid: r.pid,
        hasStdin: Boolean(r.stdin),
      }));
      respond(true, { runs });
    },
  );
}
