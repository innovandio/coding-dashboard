import { readFile } from "fs/promises";
import { join } from "path";

export interface GsdTaskMeta {
  taskType?: "phase" | "plan";
  phaseNumber?: number;
}

export interface GsdTask {
  id: string;
  project_id: string;
  title: string;
  status: "todo" | "doing" | "blocked" | "done";
  wave: number | null;
  file_path: string;
  meta: GsdTaskMeta;
}

const STATUS_MAP: Record<string, GsdTask["status"]> = {
  "[ ]": "todo",
  "[x]": "done",
  "[X]": "done",
  "[~]": "doing",
  "[!]": "blocked",
  "[-]": "blocked",
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

// Strip markdown bold markers: **text** → text
function stripBold(text: string): string {
  return text.replace(/\*\*/g, "");
}

async function parseTaskFile(
  filePath: string,
  projectId: string
): Promise<GsdTask[]> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return [];
  }

  const tasks: GsdTask[] = [];
  let currentWave: number | null = null;
  let currentPhase: number | null = null;

  for (const line of content.split("\n")) {
    // Detect wave/phase headers like "## Wave 1", "## Phase 2"
    const headerMatch = line.match(/^#{1,4}\s+(?:Wave|Phase)\s+(\d+)/i);
    if (headerMatch) {
      const num = parseInt(headerMatch[1], 10);
      currentWave = num;
      currentPhase = num;
      continue;
    }

    // Detect task lines like "- [ ] Some task" or "- [x] Done task"
    const taskMatch = line.match(/^[\s]*[-*]\s+(\[.\])\s+(.+)/);
    if (taskMatch) {
      const marker = taskMatch[1];
      let title = stripBold(taskMatch[2].trim());
      const status = STATUS_MAP[marker] ?? "todo";

      const meta: GsdTaskMeta = {};

      // Detect phase-summary lines: "Phase N: title" (after bold stripping)
      const phaseMatch = title.match(/^Phase\s+(\d+)\s*[:\-–—]\s*(.+)/i);
      if (phaseMatch) {
        const phaseNum = parseInt(phaseMatch[1], 10);
        meta.taskType = "phase";
        meta.phaseNumber = phaseNum;
        currentPhase = phaseNum;
        title = `Phase ${phaseNum}: ${phaseMatch[2].trim()}`;
      }
      // Detect plan lines: "NN-NN-PLAN.md — description" or "NN-NN — description"
      else {
        const planMatch = title.match(/^(\d{2})-(\d{2})(?:-PLAN\.md)?\s*[—–\-]\s*(.+)/);
        if (planMatch) {
          const phaseNum = parseInt(planMatch[1], 10);
          meta.taskType = "plan";
          meta.phaseNumber = phaseNum;
          title = planMatch[3].trim();
        } else if (currentPhase !== null) {
          // Items under a phase header inherit the phase number
          meta.taskType = "plan";
          meta.phaseNumber = currentPhase;
        }
      }

      const slug = slugify(title);
      const id = `${projectId}:${slug}`;

      tasks.push({
        id,
        project_id: projectId,
        title,
        status,
        wave: meta.phaseNumber ?? currentWave,
        file_path: filePath,
        meta,
      });
    }
  }

  return tasks;
}

export async function parseGsdFiles(
  workspacePath: string,
  projectId: string
): Promise<GsdTask[]> {
  const candidates = [
    "STATE.md",
    "PLAN.md",
    ".planning/STATE.md",
    ".planning/PLAN.md",
    ".planning/ROADMAP.md",
  ];

  const allTasks: GsdTask[] = [];

  for (const file of candidates) {
    const fullPath = join(workspacePath, file);
    const tasks = await parseTaskFile(fullPath, projectId);
    allTasks.push(...tasks);
  }

  return allTasks;
}
