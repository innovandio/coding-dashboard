import { readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { getPool } from "./db";

const execFileAsync = promisify(execFile);
const TEMPLATES_DIR = join(process.cwd(), "agent-templates");

const EMOJIS = "🦊🐙🦉🐝🦋🐬🦎🐢🦜🐧🦀🐳🦈🐺🦁🐯🐻🐨🐼🐸🦩🦚🐿️🦔🦦🦡🐞🐌🦂🦑";
function randomEmoji(): string {
  const chars = [...EMOJIS];
  return chars[Math.floor(Math.random() * chars.length)];
}
const COMPOSE_OVERRIDE = join(process.cwd(), "docker-compose.override.yml");

/** Path inside the gateway container where the agentdata volume is mounted */
export const CONTAINER_AGENTS_ROOT = "/data/agents";

interface ScaffoldContext {
  projectId: string;
  projectName: string;
  /** Overwrite existing files (use on initial creation to replace defaults) */
  force?: boolean;
}

/** Resolve the agent-dir path as seen by the gateway container */
export function agentDir(agentId: string): string {
  return `${CONTAINER_AGENTS_ROOT}/${agentId}`;
}

/**
 * Copy agent template MD files into the agent-dir volume inside the gateway
 * container. The agent's workspace is set to the agent-dir so OpenClaw reads
 * definition files (IDENTITY.md, SOUL.md, …) from there.
 *
 * Skips files that already exist (no-clobber).
 * Replaces {{projectName}} and {{projectId}} placeholders.
 */
export async function scaffoldAgentFiles(ctx: ScaffoldContext): Promise<void> {
  const destDir = agentDir(ctx.projectId);

  // Wait for the gateway container to be ready for exec commands (it may have
  // just been recreated by syncGatewayMounts).
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await execFileAsync("docker", ["compose", "exec", "openclaw-gateway", "true"]);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // Ensure destination directory exists inside the container.
  await execFileAsync("docker", ["compose", "exec", "openclaw-gateway", "mkdir", "-p", destDir]);

  const files = await readdir(TEMPLATES_DIR);

  for (const file of files) {
    if (!file.endsWith(".md")) continue;

    const dest = `${destDir}/${file}`;

    // Check if file already exists in the container (no-clobber unless force)
    if (!ctx.force) {
      try {
        await execFileAsync("docker", ["compose", "exec", "openclaw-gateway", "test", "-f", dest]);
        continue; // File exists — skip
      } catch {
        // File doesn't exist — proceed
      }
    }

    let content = await readFile(join(TEMPLATES_DIR, file), "utf-8");
    content = content.replaceAll("{{projectName}}", ctx.projectName);
    content = content.replaceAll("{{projectId}}", ctx.projectId);
    content = content.replaceAll("{{randomEmoji}}", randomEmoji());

    // Write file into the container via base64 to avoid stdin piping issues
    const b64 = Buffer.from(content).toString("base64");
    await execFileAsync("docker", [
      "compose",
      "exec",
      "-T",
      "openclaw-gateway",
      "sh",
      "-c",
      `echo '${b64}' | base64 -d > '${dest}'`,
    ]);
  }

  console.log(`[agent-scaffold] Scaffolded agent files for ${ctx.projectId} in ${destDir}`);
}

/**
 * Regenerate docker-compose.override.yml with workspace volume mounts for all
 * projects, then recreate the gateway container so it picks up the new mounts.
 */
export async function syncGatewayMounts(): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string; workspace_path: string }>(
    `SELECT id, workspace_path FROM projects WHERE workspace_path IS NOT NULL`,
  );

  const volumes = rows.map((r) => `      - ${r.workspace_path}:/projects/${r.id}`);

  const override =
    [
      "# Auto-generated — do not edit. Managed by agent-scaffold.ts",
      "services:",
      "  openclaw-gateway:",
      "    volumes:",
      ...volumes,
    ].join("\n") + "\n";

  await writeFile(COMPOSE_OVERRIDE, override);

  // Recreate the gateway so it picks up the new volume mounts.
  // `up -d` only recreates if the config changed.
  await execFileAsync("docker", ["compose", "up", "-d", "openclaw-gateway"]);

  console.log(`[agent-scaffold] Synced gateway mounts for ${rows.length} project(s)`);
}
