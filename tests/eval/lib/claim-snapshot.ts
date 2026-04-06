import { execFile } from "child_process";
import { readFile } from "fs/promises";
import { join } from "path";
import { promisify } from "util";
import type { ClaimSnapshot } from "./types";

const execFileAsync = promisify(execFile);

const GSD_FILES = [
  "STATE.md",
  "PLAN.md",
  ".planning/STATE.md",
  ".planning/PLAN.md",
  ".planning/ROADMAP.md",
];

async function getGitSha(workspacePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: workspacePath,
    });
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

async function getChangedFiles(workspacePath: string, baseSha?: string): Promise<string[]> {
  try {
    const diffArgs = baseSha ? ["diff", "--name-only", baseSha] : ["diff", "--name-only", "HEAD"];
    const untrackedArgs = ["ls-files", "--others", "--exclude-standard"];

    const [diffResult, untrackedResult] = await Promise.all([
      execFileAsync("git", diffArgs, {
        cwd: workspacePath,
      }),
      execFileAsync("git", untrackedArgs, {
        cwd: workspacePath,
      }),
    ]);

    return [...diffResult.stdout.trim().split("\n"), ...untrackedResult.stdout.trim().split("\n")]
      .filter(Boolean)
      .filter((file, index, arr) => arr.indexOf(file) === index);
  } catch {
    return [];
  }
}

async function readGsdFiles(workspacePath: string): Promise<Record<string, string>> {
  const contents: Record<string, string> = {};
  for (const file of GSD_FILES) {
    try {
      contents[file] = await readFile(join(workspacePath, file), "utf-8");
    } catch {
      // File doesn't exist — skip
    }
  }
  return contents;
}

/**
 * Capture a snapshot of the workspace state at the moment a GSD phase
 * is marked as done. This anchors the eval to the exact code state
 * the agent considered "complete."
 */
export async function captureClaimSnapshot(
  workspacePath: string,
  phase: number,
  baseSha?: string,
): Promise<ClaimSnapshot> {
  const [git_sha, files_changed, gsd_file_contents] = await Promise.all([
    getGitSha(workspacePath),
    getChangedFiles(workspacePath, baseSha),
    readGsdFiles(workspacePath),
  ]);

  return {
    phase,
    claimed_at: new Date().toISOString(),
    git_sha,
    files_changed,
    gsd_file_contents,
  };
}
