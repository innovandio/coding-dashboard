import { readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { getPool } from "./db";

const execFileAsync = promisify(execFile);
const TEMPLATES_DIR = join(process.cwd(), "agent-templates");
const COMPOSE_OVERRIDE = join(process.cwd(), "docker-compose.override.yml");

/** Path inside the gateway container where the agentdata volume is mounted */
export const CONTAINER_AGENTS_ROOT = "/data/agents";

interface ScaffoldContext {
  projectId: string;
  projectName: string;
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

  // Ensure destination directory exists inside the container.
  // Use -u root because the agentdata volume root is owned by root,
  // then chown to node so the gateway process can read the files.
  await execFileAsync("docker", [
    "compose", "exec", "-u", "root", "openclaw-gateway",
    "sh", "-c", `mkdir -p ${destDir} && chown node:node ${destDir}`,
  ]);

  const files = await readdir(TEMPLATES_DIR);

  for (const file of files) {
    if (!file.endsWith(".md")) continue;

    const dest = `${destDir}/${file}`;

    // Check if file already exists in the container (no-clobber)
    try {
      await execFileAsync("docker", [
        "compose", "exec", "openclaw-gateway",
        "test", "-f", dest,
      ]);
      continue; // File exists — skip
    } catch {
      // File doesn't exist — proceed
    }

    let content = await readFile(join(TEMPLATES_DIR, file), "utf-8");
    content = content.replaceAll("{{projectName}}", ctx.projectName);
    content = content.replaceAll("{{projectId}}", ctx.projectId);

    // Write file into the container via stdin
    await execFileAsync("docker", [
      "compose", "exec", "-T", "openclaw-gateway",
      "sh", "-c", `cat > '${dest}'`,
    ], { input: content } as never);
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
    `SELECT id, workspace_path FROM projects WHERE workspace_path IS NOT NULL`
  );

  const volumes = rows.map(
    (r) => `      - ${r.workspace_path}:/projects/${r.id}`
  );

  const override = [
    "# Auto-generated — do not edit. Managed by agent-scaffold.ts",
    "services:",
    "  openclaw-gateway:",
    "    volumes:",
    ...volumes,
  ].join("\n") + "\n";

  await writeFile(COMPOSE_OVERRIDE, override);

  // Recreate the gateway so it picks up the new volume mounts.
  // `up -d` only recreates if the config changed.
  await execFileAsync("docker", [
    "compose",
    "up",
    "-d",
    "openclaw-gateway",
  ]);

  console.log(`[agent-scaffold] Synced gateway mounts for ${rows.length} project(s)`);
}
