import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { tmuxSessionName } from "./tmux-scanner";

const execFileAsync = promisify(execFile);

const MARKER_BEGIN = "# openclaw-dashboard:begin";
const MARKER_END = "# openclaw-dashboard:end";
const TARGET_FILE = "AGENTS.md";

interface InstructionContext {
  projectId: string;
  projectName: string;
  workspacePath: string;
  tmuxSession?: string;
}

function generateBlock(ctx: InstructionContext): string {
  const lines: string[] = [
    MARKER_BEGIN,
    "## Dashboard Integration",
    "",
    "This workspace is connected to the OpenClaw Dashboard.",
    "",
  ];

  if (ctx.tmuxSession) {
    lines.push(
      "### Claude Code Terminal",
      `Claude Code runs in tmux session \`${ctx.tmuxSession}\`.`,
      `Attach: \`tmux attach -t ${ctx.tmuxSession}\``,
      "",
    );
  }

  lines.push(
    "### Watched Planning Files",
    "The dashboard monitors these files and updates the task board in real-time (~500ms):",
    "- `.planning/ROADMAP.md` — Phase/milestone roadmap",
    "- `.planning/STATE.md` — Current state",
    "- `.planning/PLAN.md` — Active execution plan",
    "- `STATE.md` / `PLAN.md` — Root-level alternatives",
    "",
    "Task markers: `[ ]` todo · `[~]` doing · `[x]` done · `[!]` blocked",
    "",
    "### Project",
    `- **ID**: ${ctx.projectId}`,
    `- **Name**: ${ctx.projectName}`,
    MARKER_END,
  );

  return lines.join("\n");
}

export async function syncAgentInstructions(ctx: InstructionContext): Promise<void> {
  const filePath = join(ctx.workspacePath, TARGET_FILE);

  let existing = "";
  try {
    existing = await readFile(filePath, "utf-8");
  } catch {
    // File doesn't exist — we'll create it
  }

  const block = generateBlock(ctx);

  let updated: string;
  const beginIdx = existing.indexOf(MARKER_BEGIN);
  const endIdx = existing.indexOf(MARKER_END);

  if (beginIdx !== -1 && endIdx !== -1) {
    // Replace existing block (from begin marker through end marker)
    updated = existing.slice(0, beginIdx) + block + existing.slice(endIdx + MARKER_END.length);
  } else {
    // Append block with separator
    const separator = existing.length > 0 && !existing.endsWith("\n\n")
      ? (existing.endsWith("\n") ? "\n" : "\n\n")
      : "";
    updated = existing + separator + block + "\n";
  }

  if (updated === existing) return;

  await writeFile(filePath, updated, "utf-8");
  console.log(`[agent-instructions] Synced ${TARGET_FILE} for project ${ctx.projectId}`);
}

export async function removeAgentInstructions(workspacePath: string): Promise<void> {
  const filePath = join(workspacePath, TARGET_FILE);

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return; // File doesn't exist, nothing to remove
  }

  const beginIdx = content.indexOf(MARKER_BEGIN);
  const endIdx = content.indexOf(MARKER_END);
  if (beginIdx === -1 || endIdx === -1) return;

  // Remove block including surrounding blank lines
  let before = content.slice(0, beginIdx);
  let after = content.slice(endIdx + MARKER_END.length);

  // Trim trailing whitespace from before and leading whitespace from after
  before = before.replace(/\n+$/, "");
  after = after.replace(/^\n+/, "");

  const updated = before.length > 0 && after.length > 0
    ? before + "\n\n" + after
    : before + after;

  // If nothing left, leave an empty file rather than deleting
  const final = updated.trim().length > 0 ? updated.trimEnd() + "\n" : "";

  if (final === content) return;

  await writeFile(filePath, final, "utf-8");
  console.log(`[agent-instructions] Removed dashboard block from ${TARGET_FILE} at ${workspacePath}`);
}

async function hasTmuxSession(projectId: string): Promise<string | undefined> {
  const name = tmuxSessionName(projectId);
  try {
    await execFileAsync("tmux", ["has-session", "-t", name]);
    return name;
  } catch {
    return undefined;
  }
}

export async function syncAllProjectInstructions(
  projects: { id: string; name: string; workspace_path: string | null }[]
): Promise<void> {
  for (const project of projects) {
    if (!project.workspace_path) continue;
    try {
      const tmuxSession = await hasTmuxSession(project.id);
      await syncAgentInstructions({
        projectId: project.id,
        projectName: project.name,
        workspacePath: project.workspace_path,
        tmuxSession,
      });
    } catch (err) {
      console.error(`[agent-instructions] Failed to sync for project ${project.id}:`, err);
    }
  }
}
