import { execFile } from "child_process";
import { EventEmitter } from "events";

export interface TmuxSession {
  name: string;
  windows: number;
  created: number;
  attached: boolean;
}

export interface TmuxOutputEvent {
  session: string;
  output: string;
  timestamp: string;
}

interface ManagedSession {
  sessionName: string;
  workspacePath: string;
}

const CAPTURE_FAST_MS = 200;
const CAPTURE_SLOW_MS = 2000;
const CAPTURE_IDLE_AFTER_MS = 3000;

interface TmuxScannerState {
  emitter: EventEmitter;
  sessions: TmuxSession[];
  sessionTimer: ReturnType<typeof setInterval> | null;
  captureTimer: ReturnType<typeof setTimeout> | null;
  activeCapture: string | null;
  lastOutput: string;
  lastActivity: number;
  clientCount: number;
  managedSessions: Map<string, ManagedSession>;
}

const globalForTmux = globalThis as unknown as {
  tmuxScannerStarted?: boolean;
  tmuxScannerState?: TmuxScannerState;
};

function getState(): TmuxScannerState {
  if (!globalForTmux.tmuxScannerState) {
    globalForTmux.tmuxScannerState = {
      emitter: new EventEmitter(),
      sessions: [],
      sessionTimer: null,
      captureTimer: null,
      activeCapture: null,
      lastOutput: "",
      lastActivity: 0,
      clientCount: 0,
      managedSessions: new Map(),
    };
  }
  return globalForTmux.tmuxScannerState;
}

function runTmux(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("tmux", args, { timeout: 5000 }, (err, stdout) => {
      if (err) {
        // tmux not installed
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          resolve("");
          return;
        }
        // "no server running" or "no sessions" — exit code 1
        if (err.code === 1) {
          resolve("");
          return;
        }
        reject(err);
        return;
      }
      resolve(stdout);
    });
  });
}

async function pollSessions() {
  const state = getState();
  try {
    const raw = await runTmux([
      "list-sessions",
      "-F",
      "#{session_name}\t#{session_windows}\t#{session_created}\t#{session_attached}",
    ]);
    if (!raw.trim()) {
      state.sessions = [];
      return;
    }
    state.sessions = raw
      .trim()
      .split("\n")
      .map((line) => {
        const [name, windows, created, attached] = line.split("\t");
        return {
          name,
          windows: parseInt(windows, 10),
          created: parseInt(created, 10),
          attached: attached === "1",
        };
      });
  } catch (err) {
    console.warn("[tmux-scanner] Error polling sessions:", err);
    state.sessions = [];
  }

  // Health check: recreate any managed sessions that have disappeared
  const activeNames = new Set(state.sessions.map((s) => s.name));
  for (const [projectId, managed] of state.managedSessions) {
    if (!activeNames.has(managed.sessionName)) {
      console.log(`[tmux-scanner] Managed session ${managed.sessionName} disappeared, recreating`);
      ensureTmuxSession(projectId).then(() => {
        if (managed.workspacePath) {
          launchClaudeInSession(managed.sessionName, managed.workspacePath);
        }
      }).catch((err) => {
        console.warn(`[tmux-scanner] Failed to recreate session ${managed.sessionName}:`, err);
      });
    }
  }
}

async function pollCapture() {
  const state = getState();
  if (!state.activeCapture) return;

  try {
    const output = await runTmux([
      "capture-pane",
      "-p",
      "-e",
      "-t",
      state.activeCapture,
      "-S",
      "-500",
    ]);
    if (output !== state.lastOutput) {
      state.lastOutput = output;
      state.lastActivity = Date.now();
      const event: TmuxOutputEvent = {
        session: state.activeCapture,
        output,
        timestamp: new Date().toISOString(),
      };
      state.emitter.emit("tmux:output", event);
    }
  } catch {
    // Session may have been killed — stop capture
    state.activeCapture = null;
    state.lastOutput = "";
    stopCapturePolling();
  }

  scheduleCapturePolling();
}

function scheduleCapturePolling() {
  const state = getState();
  if (!state.activeCapture) return;
  if (state.captureTimer) return;
  const idle = Date.now() - state.lastActivity > CAPTURE_IDLE_AFTER_MS;
  const delay = idle ? CAPTURE_SLOW_MS : CAPTURE_FAST_MS;
  state.captureTimer = setTimeout(() => {
    state.captureTimer = null;
    pollCapture();
  }, delay);
}

function markCaptureActive() {
  const state = getState();
  state.lastActivity = Date.now();
  // If we're currently waiting on a slow poll, cancel and reschedule fast
  if (state.captureTimer) {
    clearTimeout(state.captureTimer);
    state.captureTimer = null;
  }
  scheduleCapturePolling();
}

function startCapturePolling() {
  const state = getState();
  if (state.captureTimer) return;
  state.lastActivity = Date.now();
  pollCapture();
}

function stopCapturePolling() {
  const state = getState();
  if (state.captureTimer) {
    clearTimeout(state.captureTimer);
    state.captureTimer = null;
  }
}

export function startTmuxScanner() {
  if (globalForTmux.tmuxScannerStarted) return;
  globalForTmux.tmuxScannerStarted = true;

  const state = getState();
  console.log("[tmux-scanner] Starting tmux session scanner");

  // Initial poll
  pollSessions();

  // Poll sessions every 5s
  state.sessionTimer = setInterval(pollSessions, 5000);
}

export function getTmuxSessions(): TmuxSession[] {
  return getState().sessions;
}

export function getTmuxEmitter(): EventEmitter {
  return getState().emitter;
}

export function setActiveTmuxCapture(name: string | null) {
  const state = getState();
  state.activeCapture = name;
  state.lastOutput = "";

  if (name) {
    startCapturePolling();
  } else {
    stopCapturePolling();
  }
}

export function addTmuxClient() {
  const state = getState();
  state.clientCount++;
}

export function removeTmuxClient() {
  const state = getState();
  state.clientCount = Math.max(0, state.clientCount - 1);
  if (state.clientCount === 0) {
    setActiveTmuxCapture(null);
  }
}

// --- Managed session functions ---

export function tmuxSessionName(projectId: string): string {
  return `dash-${projectId.replace(/[^a-zA-Z0-9-]/g, "-")}`;
}

export async function ensureTmuxSession(projectId: string): Promise<string> {
  const name = tmuxSessionName(projectId);
  const raw = await runTmux(["list-sessions", "-F", "#{session_name}"]);
  const exists = raw.trim().split("\n").includes(name);

  if (!exists) {
    console.log(`[tmux-scanner] Creating managed session: ${name}`);
    await runTmux(["new-session", "-d", "-s", name]);
  }
  return name;
}

export async function launchClaudeInSession(sessionName: string, workspacePath: string): Promise<void> {
  // Check if there's already an active process running (not just the shell)
  const paneCmd = await runTmux(["list-panes", "-t", sessionName, "-F", "#{pane_current_command}"]);
  const currentCmd = paneCmd.trim();
  // Only send keys if the pane is running a shell (bash, zsh, sh, fish)
  const shellProcesses = ["bash", "zsh", "sh", "fish", "login"];
  if (currentCmd && !shellProcesses.includes(currentCmd)) {
    console.log(`[tmux-scanner] Session ${sessionName} already running: ${currentCmd}, skipping launch`);
    return;
  }

  console.log(`[tmux-scanner] Launching claude in session ${sessionName}`);
  await runTmux(["send-keys", "-t", sessionName, `cd ${workspacePath} && claude`, "Enter"]);
}

export function registerManagedSession(projectId: string, sessionName: string, workspacePath: string) {
  const state = getState();
  state.managedSessions.set(projectId, { sessionName, workspacePath });
}

export async function resizeTmuxWindow(sessionName: string, cols: number, rows: number): Promise<void> {
  await runTmux(["resize-window", "-t", sessionName, "-x", String(cols), "-y", String(rows)]);
}

export async function sendTmuxKeys(sessionName: string, keys: string, literal: boolean): Promise<void> {
  const args = ["send-keys", "-t", sessionName];
  if (literal) args.push("-l");
  args.push(keys);
  await runTmux(args);
  // Switch to fast polling and immediately capture
  markCaptureActive();
  pollCapture();
}
