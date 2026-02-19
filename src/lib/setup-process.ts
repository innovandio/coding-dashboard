/**
 * Server-side singleton that manages the `openclaw setup` interactive process.
 * Spawns the setup wizard inside the openclaw-gateway container via
 * `docker compose run`, piping stdin/stdout/stderr through an EventEmitter.
 *
 * All output is buffered so late-connecting SSE clients can replay it.
 */
import { EventEmitter } from "events";
import { spawn, type ChildProcess } from "child_process";
import { invalidateNeedsSetupCache } from "./gateway-ingestor";

export type SetupState = "idle" | "running" | "exited";

interface SetupHolder {
  emitter: EventEmitter;
  process: ChildProcess | null;
  state: SetupState;
  exitCode: number | null;
  outputBuffer: string[];
}

const globalForSetup = globalThis as unknown as { setupHolder?: SetupHolder };

function getHolder(): SetupHolder {
  if (!globalForSetup.setupHolder) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(100);
    globalForSetup.setupHolder = {
      emitter,
      process: null,
      state: "idle",
      exitCode: null,
      outputBuffer: [],
    };
  }
  // Backfill for pre-HMR instances
  if (!globalForSetup.setupHolder.outputBuffer) {
    globalForSetup.setupHolder.outputBuffer = [];
  }
  return globalForSetup.setupHolder;
}

export function getSetupEmitter(): EventEmitter {
  return getHolder().emitter;
}

export function getSetupState(): SetupState {
  return getHolder().state;
}

export function getSetupExitCode(): number | null {
  return getHolder().exitCode;
}

/** Returns all buffered output chunks from the current/last run. */
export function getSetupOutputBuffer(): string[] {
  return getHolder().outputBuffer;
}

export function startSetup(cols = 80, rows = 24): void {
  const holder = getHolder();
  if (holder.state === "running") return;

  holder.state = "running";
  holder.exitCode = null;
  holder.outputBuffer = [];

  // `docker compose run --rm` starts a fresh one-off container (works even when
  // the main service is crash-looping, unlike `exec`).
  // `-T` disables Docker TTY allocation (we pipe instead).
  // `script -qc` allocates a real PTY inside the container so inquirer prompts work.
  // stty sets the PTY size to match the client's xterm dimensions.
  const child = spawn(
    "docker",
    [
      "compose",
      "run",
      "--rm",
      "-T",
      "-e", `COLUMNS=${cols}`,
      "-e", `LINES=${rows}`,
      "openclaw-gateway",
      "script",
      "-qc",
      `stty cols ${cols} rows ${rows} 2>/dev/null; node openclaw.mjs onboard --skip-daemon --skip-ui`,
      "/dev/null",
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    },
  );

  holder.process = child;

  child.stdout?.on("data", (chunk: Buffer) => {
    const str = chunk.toString();
    holder.outputBuffer.push(str);
    holder.emitter.emit("setup:data", str);
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const str = chunk.toString();
    holder.outputBuffer.push(str);
    holder.emitter.emit("setup:data", str);
  });

  child.on("close", (code) => {
    holder.state = "exited";
    holder.exitCode = code ?? 1;
    holder.process = null;
    holder.emitter.emit("setup:exit", holder.exitCode);

    if (code === 0) {
      // Setup succeeded — restart gateway and invalidate cache
      console.log("[setup] Setup completed successfully, restarting gateway...");
      invalidateNeedsSetupCache();
      const restart = spawn("docker", ["compose", "restart", "openclaw-gateway"], {
        stdio: "ignore",
        env: { ...process.env },
      });
      restart.on("close", (rc) => {
        console.log(`[setup] Gateway restart exited with code ${rc}`);
      });
    }
  });

  child.on("error", (err) => {
    console.error("[setup] Process error:", err.message);
    holder.state = "exited";
    holder.exitCode = 1;
    holder.process = null;
    holder.emitter.emit("setup:exit", 1);
  });
}

export function writeSetupInput(data: string): void {
  const holder = getHolder();
  if (holder.process?.stdin?.writable) {
    holder.process.stdin.write(data);
  }
}

/** Reset to idle so the setup wizard can be re-run. */
export function resetSetup(): void {
  const holder = getHolder();
  if (holder.process) {
    holder.process.kill();
    holder.process = null;
  }
  holder.state = "idle";
  holder.exitCode = null;
  holder.outputBuffer = [];
}
