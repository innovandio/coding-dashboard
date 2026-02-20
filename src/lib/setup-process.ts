/**
 * Server-side singleton that manages the `openclaw setup` interactive process.
 * Spawns the setup wizard inside the openclaw-gateway container via
 * `docker compose run`, piping stdin/stdout/stderr through an EventEmitter.
 *
 * All output is buffered so late-connecting SSE clients can replay it.
 */
import { EventEmitter } from "events";
import { spawn, type ChildProcess, execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { invalidateNeedsSetupCache } from "./gateway-ingestor";

const execFileAsync = promisify(execFile);

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
      // Setup succeeded — sync token to env files, restart gateway, invalidate cache
      console.log("[setup] Setup completed successfully, syncing token and restarting gateway...");
      syncGatewayToken();
      invalidateNeedsSetupCache();
      const restart = spawn("docker", ["compose", "restart", "openclaw-gateway"], {
        stdio: "ignore",
        env: { ...process.env },
      });
      restart.on("close", (rc) => {
        console.log(`[setup] Gateway restart exited with code ${rc}`);
        if (rc === 0) {
          postSetupDeviceApproval(holder.emitter).catch((err) =>
            console.warn("[setup] Post-setup device approval failed:", err)
          );
        }
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

/**
 * Read the gateway token from ~/.openclaw/openclaw.json and update
 * .env (OPENCLAW_GATEWAY_TOKEN) and .env.local (GATEWAY_TOKEN) so the
 * dashboard and docker-compose stay in sync after onboard generates a new token.
 */
function syncGatewayToken(): void {
  try {
    const home = process.env.HOME ?? "/root";
    const config = JSON.parse(
      fs.readFileSync(path.join(home, ".openclaw", "openclaw.json"), "utf-8")
    );
    const token = config?.gateway?.auth?.token;
    if (!token) return;

    const projectRoot = process.cwd();

    function upsertEnvVar(file: string, key: string, value: string) {
      const filePath = path.join(projectRoot, file);
      let content = "";
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch {
        // file doesn't exist yet
      }
      const regex = new RegExp(`^${key}=.*$`, "m");
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${value}`);
      } else {
        content = content.trimEnd() + `\n${key}=${value}\n`;
      }
      fs.writeFileSync(filePath, content);
    }

    upsertEnvVar(".env", "OPENCLAW_GATEWAY_TOKEN", token);
    upsertEnvVar(".env.local", "GATEWAY_TOKEN", token);
    console.log("[setup] Synced gateway token to .env and .env.local");
  } catch (err) {
    console.warn("[setup] Failed to sync gateway token:", err);
  }
}

/** Read gateway token from config. */
function readGatewayToken(): string | null {
  try {
    const home = process.env.HOME ?? "/root";
    const config = JSON.parse(
      fs.readFileSync(path.join(home, ".openclaw", "openclaw.json"), "utf-8")
    );
    return config?.gateway?.auth?.token ?? null;
  } catch {
    return null;
  }
}

/**
 * After gateway restart: open the openclaw dashboard URL, then poll
 * `devices list` every 3s until a new pending device appears and auto-approve it.
 */
async function postSetupDeviceApproval(emitter: EventEmitter): Promise<void> {
  const token = readGatewayToken();
  if (!token) {
    console.warn("[setup] No gateway token found, skipping device approval");
    return;
  }

  const gatewayUrl = "ws://127.0.0.1:18789";
  const dashboardUrl = `http://localhost:18789/#token=${token}`;
  const cliArgs = ["--token", token, "--url", gatewayUrl, "--json"];

  // Snapshot existing pending request IDs
  const existingIds = new Set<string>();
  try {
    const { stdout } = await execFileAsync("docker", [
      "compose", "exec", "openclaw-gateway",
      "node", "openclaw.mjs", "devices", "list", ...cliArgs,
    ]);
    const data = JSON.parse(stdout);
    for (const p of data.pending ?? []) {
      existingIds.add(p.requestId);
    }
  } catch {
    // Gateway may still be starting — that's fine, we'll treat all as new
  }

  // Tell the client to open the dashboard
  emitter.emit("setup:openUrl", dashboardUrl);
  console.log(`[setup] Emitted dashboard URL: ${dashboardUrl}`);

  // Poll for new pending device
  const MAX_ATTEMPTS = 60; // 3s × 60 = 3 minutes
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, 3000));

    try {
      const { stdout } = await execFileAsync("docker", [
        "compose", "exec", "openclaw-gateway",
        "node", "openclaw.mjs", "devices", "list", ...cliArgs,
      ]);
      const data = JSON.parse(stdout);
      const newPending = (data.pending ?? []).find(
        (p: { requestId: string }) => !existingIds.has(p.requestId)
      );

      if (newPending) {
        console.log(`[setup] New pending device found: ${newPending.requestId}, approving...`);
        await execFileAsync("docker", [
          "compose", "exec", "openclaw-gateway",
          "node", "openclaw.mjs", "devices", "approve", newPending.requestId, ...cliArgs,
        ]);
        console.log("[setup] Device approved successfully");
        emitter.emit("setup:deviceApproved", newPending.requestId);
        return;
      }
    } catch (err) {
      console.warn("[setup] Device poll error:", err instanceof Error ? err.message : err);
    }
  }

  console.warn("[setup] Timed out waiting for new device pairing request");
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
