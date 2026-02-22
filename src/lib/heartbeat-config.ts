import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface HeartbeatConfig {
  enabled: boolean;
  every: string; // "30m", "1h", etc.
  activeHoursStart: string; // "HH:MM" or ""
  activeHoursEnd: string; // "HH:MM" or ""
  prompt: string; // custom prompt or "" for default
}

export function defaultHeartbeatConfig(): HeartbeatConfig {
  return {
    enabled: false,
    every: "30m",
    activeHoursStart: "",
    activeHoursEnd: "",
    prompt: "",
  };
}

/**
 * Read heartbeat config for an agent from openclaw.json inside the container.
 * Config lives inside the agents.list[] entry for the agent.
 * Returns defaults if not configured.
 */
export async function readHeartbeatConfig(agentId: string): Promise<HeartbeatConfig> {
  try {
    const { stdout } = await execFileAsync("docker", [
      "compose",
      "exec",
      "-T",
      "openclaw-gateway",
      "sh",
      "-c",
      `node -e "
        const fs = require('fs');
        const f = process.env.HOME + '/.openclaw/openclaw.json';
        const d = JSON.parse(fs.readFileSync(f, 'utf8'));
        const list = (d.agents && d.agents.list) || [];
        const entry = list.find(a => a.id === '${agentId}');
        const hb = (entry && entry.heartbeat) || null;
        console.log(JSON.stringify(hb));
      "`,
    ]);
    const hb = JSON.parse(stdout.trim());
    if (!hb) return defaultHeartbeatConfig();
    return {
      enabled: true,
      every: hb.every || "30m",
      activeHoursStart: hb.activeHours?.start || "",
      activeHoursEnd: hb.activeHours?.end || "",
      prompt: hb.prompt || "",
    };
  } catch {
    return defaultHeartbeatConfig();
  }
}

/**
 * Write heartbeat config for an agent into openclaw.json inside the container.
 * Config is stored inside the agents.list[] entry for the agent.
 * If enabled=false, removes the heartbeat key entirely.
 * Uses base64-encoded JSON env var to avoid shell escaping issues.
 */
export async function writeHeartbeatConfig(
  agentId: string,
  config: HeartbeatConfig,
): Promise<void> {
  const payload = Buffer.from(JSON.stringify(config)).toString("base64");
  await execFileAsync("docker", [
    "compose",
    "exec",
    "-T",
    "openclaw-gateway",
    "sh",
    "-c",
    `HB_PAYLOAD="${payload}" node -e "
      const fs = require('fs');
      const f = process.env.HOME + '/.openclaw/openclaw.json';
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!d.agents) d.agents = {};
      if (!d.agents.list) d.agents.list = [];
      let entry = d.agents.list.find(a => a.id === '${agentId}');
      if (!entry) {
        entry = { id: '${agentId}' };
        d.agents.list.push(entry);
      }
      const cfg = JSON.parse(Buffer.from(process.env.HB_PAYLOAD, 'base64').toString());
      if (!cfg.enabled) {
        delete entry.heartbeat;
      } else {
        const hb = { every: cfg.every };
        if (cfg.activeHoursStart && cfg.activeHoursEnd) {
          hb.activeHours = { start: cfg.activeHoursStart, end: cfg.activeHoursEnd };
        }
        if (cfg.prompt) hb.prompt = cfg.prompt;
        entry.heartbeat = hb;
      }
      fs.writeFileSync(f, JSON.stringify(d, null, 2));
    "`,
  ]);
}
