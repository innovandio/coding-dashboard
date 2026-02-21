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
 * Replaces the old 001-pty-events.patch — no source modifications needed.
 */

interface PtyMeta {
  runId: string;
  sessionId: string;
  backendId: string;
  label: string;
}

const ptyBus = new EventEmitter();
ptyBus.setMaxListeners(200);

let supervisorWrapped = false;

async function wrapSupervisor() {
  if (supervisorWrapped) return;
  supervisorWrapped = true;

  // Dynamic import — resolved by jiti at runtime inside the openclaw process.
  const supervisorModule = await import("/app/src/process/supervisor/index.ts");
  const supervisor = supervisorModule.getProcessSupervisor();
  const originalSpawn = supervisor.spawn.bind(supervisor);

  supervisor.spawn = async (input: any) => {
    if (input.mode !== "pty") {
      return originalSpawn(input);
    }

    // Build metadata for this PTY session.
    const meta: PtyMeta = {
      runId: input.runId || "", // will be updated after spawn
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

    // Now we have the real runId and pid.
    meta.runId = run.runId;

    ptyBus.emit("started", { ...meta, pid: run.pid });

    run.wait().then(() => {
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

  api.registerGatewayMethod(
    "pty.subscribe",
    async ({ respond, context }: GatewayRequestHandlerOptions) => {
      activateBroadcast(context.broadcast);
      await wrapSupervisor();
      respond(true, { subscribed: true });
    },
  );
}
