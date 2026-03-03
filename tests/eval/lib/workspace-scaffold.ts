import { cp, mkdir, stat, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";
import type { Scenario, GsdPhaseSpec } from "./types";

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures");
const REFERENCES_DIR = join(__dirname, "..", "references");

function generateGsdMarkdown(phases: GsdPhaseSpec[]): string {
  const lines: string[] = ["# Project State", ""];

  for (const phase of phases) {
    lines.push(`## Phase ${phase.phase}`);
    lines.push("");
    lines.push(`- [ ] **Phase ${phase.phase}: ${phase.title}**`);
    for (const plan of phase.plans) {
      lines.push(`  - [ ] ${plan}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export interface ScaffoldResult {
  workspacePath: string;
  baseSha: string;
}

/**
 * Scaffold a workspace for an eval scenario:
 * 1. Copy the fixture template into a temp directory
 * 2. Generate GSD markdown files from the scenario's phase specs
 * 3. Initialize git so we can track changes
 */
export async function scaffoldWorkspace(
  scenario: Scenario,
  targetDir: string,
): Promise<ScaffoldResult> {
  const fixtureDir = join(FIXTURES_DIR, scenario.fixture);

  await mkdir(targetDir, { recursive: true });
  await cp(fixtureDir, targetDir, {
    recursive: true,
    filter: (sourcePath) => {
      const normalized = sourcePath.replaceAll("\\", "/");
      return (
        !normalized.includes("/node_modules/") &&
        !normalized.endsWith("/node_modules") &&
        !normalized.includes("/.next/") &&
        !normalized.endsWith("/.next")
      );
    },
  });

  // Install dependencies so build/type/lint checks reflect code quality, not
  // missing node_modules.
  const lockFilePath = join(targetDir, "pnpm-lock.yaml");
  const hasLockFile = await stat(lockFilePath)
    .then((entry) => entry.isFile())
    .catch(() => false);
  const installArgs = hasLockFile ? ["install", "--frozen-lockfile"] : ["install"];
  await execFileAsync("pnpm", installArgs, {
    cwd: targetDir,
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  // Generate GSD files
  const planningDir = join(targetDir, ".planning");
  await mkdir(planningDir, { recursive: true });

  const stateContent = generateGsdMarkdown(scenario.gsd_tasks);
  await writeFile(join(targetDir, "STATE.md"), stateContent);
  await writeFile(join(planningDir, "STATE.md"), stateContent);

  // Initialize git repo for snapshot tracking
  try {
    await execFileAsync("git", ["init"], { cwd: targetDir });
    await execFileAsync("git", ["add", "."], { cwd: targetDir });
    await execFileAsync("git", ["commit", "-m", "Initial scaffold", "--allow-empty"], {
      cwd: targetDir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "eval-framework",
        GIT_AUTHOR_EMAIL: "eval@local",
        GIT_COMMITTER_NAME: "eval-framework",
        GIT_COMMITTER_EMAIL: "eval@local",
      },
    });

    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: targetDir,
    });

    return { workspacePath: targetDir, baseSha: stdout.trim() };
  } catch {
    return { workspacePath: targetDir, baseSha: "unknown" };
  }
}

/**
 * Copy a reference implementation into a target directory for calibration.
 */
export async function copyReference(refPath: string, targetDir: string): Promise<void> {
  const fullPath = join(REFERENCES_DIR, refPath);
  await mkdir(targetDir, { recursive: true });
  await cp(fullPath, targetDir, { recursive: true });
}
