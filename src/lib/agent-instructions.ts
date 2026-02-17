import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { tmuxSessionName } from "./tmux-scanner";

const execFileAsync = promisify(execFile);

const MARKER_BEGIN = "# openclaw-dashboard:begin";
const MARKER_END = "# openclaw-dashboard:end";

const TARGET_FILES = ["AGENTS.md", "TOOLS.md"] as const;

interface InstructionContext {
  projectId: string;
  projectName: string;
  workspacePath: string;
  tmuxSession?: string;
}

function generateToolsBlock(ctx: InstructionContext): string {
  const lines: string[] = [
    MARKER_BEGIN,
    "## OpenClaw Dashboard",
    "",
    "This workspace is connected to the OpenClaw Dashboard.",
    "",
    "### Project",
    `- **ID**: ${ctx.projectId}`,
    `- **Name**: ${ctx.projectName}`,
    "",
  ];

  if (ctx.tmuxSession) {
    lines.push(
      "### Terminal Session",
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
    "### GSD Workflow",
    "This project uses the [GSD](https://github.com/gsd-build/get-shit-done) workflow for planning and execution.",
    "",
    "**Key commands:**",
    "- `/gsd:progress` — Check current status and next steps",
    "- `/gsd:discuss-phase N` — Capture implementation decisions before planning",
    "- `/gsd:plan-phase N` — Research and create verified task plans",
    "- `/gsd:execute-phase N` — Run plans in parallel waves with atomic commits",
    "- `/gsd:verify-work N` — User acceptance testing",
    "- `/gsd:complete-milestone` — Archive milestone and tag release",
    "- `/gsd:quick` — Ad-hoc tasks without full planning overhead",
    "- `/gsd:debug` — Systematic debugging with persistent state",
    MARKER_END,
  );

  return lines.join("\n");
}

function generateAgentsBlock(): string {
  const lines: string[] = [
    MARKER_BEGIN,
    "## Autonomous Agent Mission",
    "",
    "Autonomously drive the current milestone to completion with **zero human intervention**. You take over all roles — including the human-facing steps like discuss and verify.",
    "",
    "### Startup procedure",
    "",
    "1. Review the project — understand its purpose, tech stack, and structure",
    "2. Check for existing GSD state: `.planning/` directory, `PROJECT.md`, `ROADMAP.md`, `STATE.md`",
    "3. Run `/gsd:progress` to determine where things stand",
    "4. If no GSD project exists yet, run `/gsd:new-project --auto` to initialize it",
    "",
    "### Phase loop",
    "",
    "For each incomplete phase, execute this cycle:",
    "",
    "1. **Discuss** (`/gsd:discuss-phase N`) — Act as the human stakeholder. Make reasonable choices based on existing codebase conventions, best practices, and pragmatism.",
    "2. **Plan** (`/gsd:plan-phase N`) — Fully automated. Let it complete.",
    "3. **Execute** (`/gsd:execute-phase N`) — Fully automated. Let it complete.",
    "4. **Verify** (`/gsd:verify-work N`) — Act as the human tester. Run tests, inspect output, approve when deliverables match phase goals. If something fails, let verify create fix plans and re-execute.",
    "5. **Repeat** — Move to the next phase until all are complete.",
    "",
    "### Milestone completion",
    "",
    "1. Run `/gsd:audit-milestone` to verify the milestone achieved its definition of done",
    "2. Run `/gsd:complete-milestone` to archive and tag",
    "",
    "### Guidelines",
    "",
    "- Use `/gsd:settings` to set mode to `yolo` (auto-approve) at the start",
    "- If you hit context limits mid-phase, use `/gsd:pause-work` then `/gsd:resume-work`",
    "- If a phase fails verification repeatedly (3+ times), pause and report the issue — do not loop forever",
    "- Provide brief status updates between phases so progress can be monitored",
    MARKER_END,
  ];

  return lines.join("\n");
}

/** Sync a marked block into a file — idempotent replace or append. */
async function syncBlock(filePath: string, block: string): Promise<void> {
  let existing = "";
  try {
    existing = await readFile(filePath, "utf-8");
  } catch {
    // File doesn't exist — we'll create it
  }

  let updated: string;
  const beginIdx = existing.indexOf(MARKER_BEGIN);
  const endIdx = existing.indexOf(MARKER_END);

  if (beginIdx !== -1 && endIdx !== -1) {
    updated = existing.slice(0, beginIdx) + block + existing.slice(endIdx + MARKER_END.length);
  } else {
    const separator = existing.length > 0 && !existing.endsWith("\n\n")
      ? (existing.endsWith("\n") ? "\n" : "\n\n")
      : "";
    updated = existing + separator + block + "\n";
  }

  if (updated === existing) return;

  await writeFile(filePath, updated, "utf-8");
}

/** Remove a marked block from a file. */
async function removeBlock(filePath: string): Promise<void> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return;
  }

  const beginIdx = content.indexOf(MARKER_BEGIN);
  const endIdx = content.indexOf(MARKER_END);
  if (beginIdx === -1 || endIdx === -1) return;

  let before = content.slice(0, beginIdx);
  let after = content.slice(endIdx + MARKER_END.length);

  before = before.replace(/\n+$/, "");
  after = after.replace(/^\n+/, "");

  const updated = before.length > 0 && after.length > 0
    ? before + "\n\n" + after
    : before + after;

  const final = updated.trim().length > 0 ? updated.trimEnd() + "\n" : "";

  if (final === content) return;

  await writeFile(filePath, final, "utf-8");
}

export async function syncAgentInstructions(ctx: InstructionContext): Promise<void> {
  await syncBlock(join(ctx.workspacePath, "TOOLS.md"), generateToolsBlock(ctx));
  await syncBlock(join(ctx.workspacePath, "AGENTS.md"), generateAgentsBlock());
  console.log(`[agent-instructions] Synced AGENTS.md + TOOLS.md for project ${ctx.projectId}`);
}

export async function removeAgentInstructions(workspacePath: string): Promise<void> {
  for (const file of TARGET_FILES) {
    await removeBlock(join(workspacePath, file));
  }
  console.log(`[agent-instructions] Removed dashboard blocks from ${workspacePath}`);
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
