import { readdir, readFile, writeFile, mkdir, access } from "fs/promises";
import { join } from "path";

const TEMPLATES_DIR = join(process.cwd(), "agent-templates");

/** Subdirectory inside workspace where agent MD files live */
export const AGENT_FILES_REL = ".openclaw/agents/project-manager";

interface ScaffoldContext {
  projectId: string;
  projectName: string;
  workspacePath: string;
}

/** Resolve the agent files directory for a given workspace */
export function agentDir(workspacePath: string): string {
  return join(workspacePath, AGENT_FILES_REL);
}

/**
 * Copy agent template MD files into a workspace, skipping files that already exist.
 * Replaces {{projectName}} and {{projectId}} placeholders.
 */
export async function scaffoldAgentFiles(ctx: ScaffoldContext): Promise<void> {
  const destDir = agentDir(ctx.workspacePath);
  await mkdir(destDir, { recursive: true });

  const files = await readdir(TEMPLATES_DIR);

  for (const file of files) {
    if (!file.endsWith(".md")) continue;

    const dest = join(destDir, file);

    // Don't overwrite existing files — the agent may have customized them
    try {
      await access(dest);
      continue;
    } catch {
      // File doesn't exist — proceed
    }

    let content = await readFile(join(TEMPLATES_DIR, file), "utf-8");
    content = content.replaceAll("{{projectName}}", ctx.projectName);
    content = content.replaceAll("{{projectId}}", ctx.projectId);

    await writeFile(dest, content, "utf-8");
  }

  console.log(`[agent-scaffold] Scaffolded agent files for ${ctx.projectId} in ${destDir}`);
}
