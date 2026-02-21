/**
 * Post-setup actions: sync gateway token, restart gateway, approve devices.
 *
 * The model is now configured via `POST /api/model-config` which calls
 * `openclaw models set` directly. This module handles the remaining steps
 * that must run after configuration is complete.
 */
import crypto from "crypto";
import { spawn, execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { invalidateNeedsSetupCache, restartIngestor } from "./gateway-ingestor";
import { startLogin, getLoginEmitter, getLoginState, resetLogin } from "./claude-login-process";

const execFileAsync = promisify(execFile);

type ProgressCallback = (step: number, label: string) => void;

/**
 * Check if Claude Code credentials exist inside the gateway container.
 */
async function isClaudeAuthed(): Promise<boolean> {
  try {
    await execFileAsync("docker", [
      "compose", "exec", "-T", "openclaw-gateway",
      "sh", "-c", "test -f $HOME/.claude/.credentials.json",
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the OAuth PKCE login flow (same as the standalone Claude login page)
 * and wait for the callback to complete. The OAuth URL is sent to the client
 * via onOAuthUrl so it can open the browser.
 */
function runClaudeOAuthLogin(
  onOAuthUrl: (url: string) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const emitter = getLoginEmitter();

    // Always reset to ensure a clean start — previous attempts may have left
    // the state at "awaiting_auth" (e.g. user closed dialog mid-flow).
    resetLogin();

    const onExit = (exitCode: number) => {
      emitter.off("login:oauth-url", onUrl);
      emitter.off("login:exit", onExit);
      if (exitCode === 0) resolve();
      else reject(new Error(`Claude OAuth login failed (exit ${exitCode})`));
    };

    const onUrl = (url: string) => {
      onOAuthUrl(url);
    };

    emitter.on("login:oauth-url", onUrl);
    emitter.on("login:exit", onExit);

    // Build redirect URI — must be http://localhost:{PORT}/callback
    const port = process.env.PORT || "3000";
    const redirectUri = `http://localhost:${port}/callback`;
    startLogin(redirectUri);
  });
}

/**
 * Run all post-setup actions after model configuration:
 * 0. Sync gateway token
 * 1. Restart gateway
 * 2. Authenticate Claude Code (OAuth)
 * 3. Configure sandbox browser
 * 4. Approve devices
 *
 * Returns the dashboard URL on success, or null on failure.
 */
export async function runPostSetup(
  onProgress: ProgressCallback,
  onOpenUrl: (url: string) => void,
  onOAuthUrl: (url: string) => void,
): Promise<string | null> {
  // Step 0: Ensure gateway token exists
  onProgress(0, "Syncing gateway token");
  invalidateNeedsSetupCache();

  const token = getOrCreateGatewayToken();

  // Update process.env so the ingestor can use the token immediately
  process.env.GATEWAY_TOKEN = token;

  // Persist token to .env BEFORE restarting the gateway, so docker-compose
  // passes it to the container.
  syncTokenToEnvFile(token);

  // Pre-configure sandbox browser as default profile (writes to openclaw.json
  // directly — no running gateway needed). The restart below picks this up.
  try {
    await execFileAsync("docker", [
      "compose", "exec", "-T", "openclaw-gateway",
      "openclaw", "config", "set", "browser.defaultProfile", '"sandbox"',
    ]);
    console.log("[setup] Set browser.defaultProfile to sandbox in config");
  } catch (err) {
    console.warn("[setup] Failed to set browser.defaultProfile:", err instanceof Error ? err.message : err);
  }

  // Enable the pty-broadcast plugin (writes to openclaw.json).
  try {
    await execFileAsync("docker", [
      "compose", "exec", "-T", "openclaw-gateway",
      "sh", "-c", `node -e "
        const f = process.env.HOME + '/.openclaw/openclaw.json';
        const fs = require('fs');
        const d = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (!d.plugins) d.plugins = {};
        if (!d.plugins.entries) d.plugins.entries = {};
        if (!d.plugins.entries['pty-broadcast']) {
          d.plugins.entries['pty-broadcast'] = { enabled: true };
          fs.writeFileSync(f, JSON.stringify(d, null, 2));
        }
      "`,
    ]);
    console.log("[setup] Enabled pty-broadcast plugin");
  } catch (err) {
    console.warn("[setup] Failed to enable pty-broadcast plugin:", err instanceof Error ? err.message : err);
  }

  // Step 1: Restart gateway (picks up new token + model config + browser default + plugins)
  onProgress(1, "Restarting gateway");
  await new Promise<void>((resolve, reject) => {
    const restart = spawn("docker", ["compose", "restart", "openclaw-gateway"], {
      stdio: "ignore",
      env: { ...process.env },
    });
    restart.on("close", (rc) => {
      console.log(`[setup] Gateway restart exited with code ${rc}`);
      if (rc === 0) resolve();
      else reject(new Error(`Gateway restart failed (code ${rc})`));
    });
    restart.on("error", reject);
  });

  // Step 2: Authenticate Claude Code (OAuth login)
  onProgress(2, "Authenticating Claude Code");
  try {
    const alreadyAuthed = await isClaudeAuthed();
    if (alreadyAuthed) {
      console.log("[setup] Claude Code already authenticated, skipping");
    } else {
      await runClaudeOAuthLogin(onOAuthUrl);
      console.log("[setup] Claude Code authenticated successfully");
    }
  } catch (err) {
    // Non-fatal — the gateway works without Claude Code auth
    console.warn("[setup] Claude Code auth failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  // Step 3: Configure sandbox browser profile
  onProgress(3, "Configuring sandbox browser");
  await configureSandboxBrowser(token);

  // Step 4: Approve devices
  onProgress(4, "Approving devices");
  const dashboardUrl = await postSetupDeviceApproval(token, onOpenUrl);

  return dashboardUrl;
}

function upsertEnvVar(file: string, key: string, value: string) {
  const filePath = path.join(process.cwd(), file);
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

/** Persist token to .env (read by both Next.js and docker-compose). */
function syncTokenToEnvFile(token: string): void {
  try {
    upsertEnvVar(".env", "GATEWAY_TOKEN", token);
    console.log("[setup] Wrote GATEWAY_TOKEN to .env");
  } catch (err) {
    console.warn("[setup] Failed to write .env:", err);
  }
}

/**
 * Read the gateway token from process.env or .env on disk.
 * If no token exists yet (first-time setup), generate one.
 */
function getOrCreateGatewayToken(): string {
  const existing = process.env.GATEWAY_TOKEN;
  if (existing) return existing;

  // Check .env file on disk
  const projectRoot = process.cwd();
  const envPath = path.join(projectRoot, ".env");
  try {
    const content = fs.readFileSync(envPath, "utf-8");
    const match = content.match(/^GATEWAY_TOKEN=(.+)$/m);
    if (match?.[1]) return match[1];
  } catch {
    // .env doesn't exist yet
  }

  // Generate a new token for first-time setup
  const token = crypto.randomBytes(24).toString("hex");
  console.log("[setup] Generated new gateway token");
  return token;
}

/**
 * Create a remote browser profile pointing at the sandbox-browser container.
 * The default profile config was already set pre-restart via `config set`.
 * This needs the gateway running, so it retries until ready.
 */
async function configureSandboxBrowser(token: string): Promise<void> {
  const cliArgs = ["--token", token, "--url", "ws://127.0.0.1:18789"];

  // Wait for gateway + check if profile already exists
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const { stdout } = await execFileAsync("docker", [
        "compose", "exec", "-T", "openclaw-gateway",
        "openclaw", "browser", "profiles", ...cliArgs, "--json",
      ]);
      const data = JSON.parse(stdout);
      const exists = (data.profiles ?? []).some(
        (p: { name: string }) => p.name === "sandbox",
      );
      if (exists) {
        console.log("[setup] Sandbox browser profile already exists");
        return;
      }
      break; // gateway is ready, profile doesn't exist — create it
    } catch {
      console.log(`[setup] Waiting for gateway to create browser profile... (attempt ${attempt + 1})`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  // Resolve sandbox-browser hostname to IP — Chrome DevTools Protocol
  // rejects non-IP/non-localhost Host headers for security.
  let cdpUrl = "http://sandbox-browser:9222";
  try {
    const { stdout: hostLine } = await execFileAsync("docker", [
      "compose", "exec", "-T", "openclaw-gateway",
      "getent", "hosts", "sandbox-browser",
    ]);
    const ip = hostLine.trim().split(/\s+/)[0];
    if (ip) {
      cdpUrl = `http://${ip}:9222`;
      console.log(`[setup] Resolved sandbox-browser to ${ip}`);
    }
  } catch {
    console.warn("[setup] Could not resolve sandbox-browser IP, using hostname");
  }

  try {
    await execFileAsync("docker", [
      "compose", "exec", "-T", "openclaw-gateway",
      "openclaw", "browser", "create-profile",
      "--name", "sandbox",
      "--cdp-url", cdpUrl,
      ...cliArgs,
    ]);
    console.log("[setup] Created sandbox browser profile");
  } catch (err) {
    // Non-fatal — browser features will work if profile is created later
    console.warn("[setup] Failed to create sandbox browser profile:", err instanceof Error ? err.message : err);
  }
}

/**
 * After gateway restart: wait for gateway ready, restart ingestor,
 * open the dashboard URL, then poll/approve pending devices.
 *
 * Returns the dashboard URL on success, or null on failure.
 */
async function postSetupDeviceApproval(
  token: string | null,
  onOpenUrl: (url: string) => void,
): Promise<string | null> {
  if (!token) {
    console.warn("[setup] No gateway token found, skipping device approval");
    return null;
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
        "openclaw", "devices", "list", ...cliArgs,
      ]);
      gatewayReady = true;
      break;
    } catch {
      console.log(`[setup] Waiting for gateway to be ready... (attempt ${wait + 1})`);
    }
  }

  // Restart ingestor with new token (even if gateway isn't ready yet)
  restartIngestor();

  // Open webchat so it creates a pairing request (must happen before polling)
  onOpenUrl(dashboardUrl);
  console.log(`[setup] Opened dashboard URL: ${dashboardUrl}`);

  if (!gatewayReady) {
    console.warn("[setup] Gateway did not become ready, skipping device approval");
    return dashboardUrl;
  }

  // Poll and approve ALL pending devices (ingestor + webchat).
  const approvedIds = new Set<string>();
  const MAX_ATTEMPTS = 60; // 3s x 60 = 3 minutes
  let approvedCount = 0;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, 3000));

    try {
      const { stdout } = await execFileAsync("docker", [
        "compose", "exec", "-T", "openclaw-gateway",
        "openclaw", "devices", "list", ...cliArgs,
      ]);
      const data = JSON.parse(stdout);

      for (const pending of data.pending ?? []) {
        if (approvedIds.has(pending.requestId)) continue;
        console.log(`[setup] Pending device found: ${pending.requestId} (${pending.clientId}), approving...`);
        try {
          await execFileAsync("docker", [
            "compose", "exec", "-T", "openclaw-gateway",
            "openclaw", "devices", "approve", pending.requestId, ...cliArgs,
          ]);
          console.log(`[setup] Device ${pending.clientId} approved successfully`);
          approvedIds.add(pending.requestId);
          approvedCount++;
        } catch (err) {
          console.warn(`[setup] Failed to approve ${pending.requestId}:`, err instanceof Error ? err.message : err);
        }
      }

      // Stop polling once we've approved at least 2 devices (ingestor + webchat)
      // or after 60s with at least 1 approval
      if (approvedCount >= 2 || (approvedCount >= 1 && i >= 20)) {
        break;
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

  return dashboardUrl;
}
