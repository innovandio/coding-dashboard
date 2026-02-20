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
import { invalidateNeedsSetupCache, restartIngestor } from "./gateway-ingestor";

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
      invalidateNeedsSetupCache();
      syncGatewayToken().then(() => {
        const restart = spawn("docker", ["compose", "restart", "openclaw-gateway"], {
          stdio: "ignore",
          env: { ...process.env },
        });
        restart.on("close", (rc) => {
          console.log(`[setup] Gateway restart exited with code ${rc}`);
          if (rc === 0) {
            // postSetupDeviceApproval waits for gateway ready, snapshots existing
            // pending devices, THEN restarts the ingestor (so the ingestor's new
            // pairing request is detected as "new" and gets approved).
            postSetupDeviceApproval(holder.emitter).catch((err) =>
              console.warn("[setup] Post-setup device approval failed:", err)
            );
          }
        });
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
 * Read the gateway token from the container's openclaw.json and update
 * .env (OPENCLAW_GATEWAY_TOKEN) and .env.local (GATEWAY_TOKEN) so the
 * dashboard and docker-compose stay in sync after onboard generates a new token.
 */
async function syncGatewayToken(): Promise<void> {
  try {
    const token = await readGatewayToken();
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

    // Update in-memory env so the ingestor uses the new token immediately
    process.env.GATEWAY_TOKEN = token;
    process.env.OPENCLAW_GATEWAY_TOKEN = token;

    console.log("[setup] Synced gateway token to .env, .env.local, and process.env");
  } catch (err) {
    console.warn("[setup] Failed to sync gateway token:", err);
  }
}

/** Read gateway token from the container's openclaw.json via docker exec. */
async function readGatewayToken(): Promise<string | null> {
  try {
    const home = process.env.HOME ?? "/root";
    const { stdout } = await execFileAsync("docker", [
      "compose", "exec", "-T", "openclaw-gateway",
      "node", "-e",
      `const c=JSON.parse(require("fs").readFileSync("${home}/.openclaw/openclaw.json","utf8"));console.log(c.gateway?.auth?.token??"")`,
    ]);
    const token = stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * After gateway restart: open the openclaw dashboard URL, then poll
 * `devices list` every 3s until a new pending device appears and auto-approve it.
 */
async function postSetupDeviceApproval(emitter: EventEmitter): Promise<void> {
  const token = await readGatewayToken();
  if (!token) {
    console.warn("[setup] No gateway token found, skipping device approval");
    return;
  }

  const gatewayUrl = "ws://127.0.0.1:18789";
  const dashboardUrl = `http://localhost:18789/#token=${token}`;
  const cliArgs = ["--token", token, "--url", gatewayUrl, "--json"];

  // Wait for gateway to be ready
  let gatewayReady = false;
  for (let wait = 0; wait < 40; wait++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      await execFileAsync("docker", [
        "compose", "exec", "-T", "openclaw-gateway",
        "node", "openclaw.mjs", "devices", "list", ...cliArgs,
      ]);
      gatewayReady = true;
      break;
    } catch {
      console.log(`[setup] Waiting for gateway to be ready... (attempt ${wait + 1})`);
    }
  }

  // Restart ingestor with new token (even if gateway isn't ready yet)
  restartIngestor();

  if (!gatewayReady) {
    console.warn("[setup] Gateway did not become ready, skipping device approval");
    return;
  }

  // Tell the client to open the dashboard (triggers webchat pairing request)
  emitter.emit("setup:openUrl", dashboardUrl);
  console.log(`[setup] Emitted dashboard URL: ${dashboardUrl}`);

  // Poll and approve ALL pending devices (ingestor + webchat).
  // After a fresh setup there's no reason to be selective — approve everything.
  const approvedIds = new Set<string>();
  const MAX_ATTEMPTS = 60; // 3s × 60 = 3 minutes
  let approvedCount = 0;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, 3000));

    try {
      const { stdout } = await execFileAsync("docker", [
        "compose", "exec", "-T", "openclaw-gateway",
        "node", "openclaw.mjs", "devices", "list", ...cliArgs,
      ]);
      const data = JSON.parse(stdout);

      for (const pending of data.pending ?? []) {
        if (approvedIds.has(pending.requestId)) continue;
        console.log(`[setup] Pending device found: ${pending.requestId} (${pending.clientId}), approving...`);
        try {
          await execFileAsync("docker", [
            "compose", "exec", "-T", "openclaw-gateway",
            "node", "openclaw.mjs", "devices", "approve", pending.requestId, ...cliArgs,
          ]);
          console.log(`[setup] Device ${pending.clientId} approved successfully`);
          approvedIds.add(pending.requestId);
          approvedCount++;
          emitter.emit("setup:deviceApproved", pending.requestId);
        } catch (err) {
          console.warn(`[setup] Failed to approve ${pending.requestId}:`, err instanceof Error ? err.message : err);
        }
      }

      // Stop polling once we've approved at least 2 devices (ingestor + webchat)
      // or after 60s with at least 1 approval
      if (approvedCount >= 2 || (approvedCount >= 1 && i >= 20)) {
        return;
      }
    } catch (err) {
      console.warn("[setup] Device poll error:", err instanceof Error ? err.message : err);
    }
  }

  if (approvedCount > 0) {
    console.log(`[setup] Approved ${approvedCount} device(s)`);
  } else {
    console.warn("[setup] Timed out waiting for new device pairing request");
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
