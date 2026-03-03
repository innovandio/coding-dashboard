import { stat } from "fs/promises";
import { watch, type FSWatcher } from "fs";
import { join } from "path";
import { parseGsdFiles } from "../../../src/lib/gsd-parser";
import { captureClaimSnapshot } from "./claim-snapshot";
import type { ClaimSnapshot } from "./types";

const EVAL_PROJECT_ID = "completion-eval";

async function getDonePhases(workspacePath: string): Promise<number[]> {
  const tasks = await parseGsdFiles(workspacePath, EVAL_PROJECT_ID);

  // Primary path: use explicit "phase" task lines.
  const phaseDone = new Map<number, boolean>();
  for (const task of tasks) {
    if (task.meta.taskType !== "phase" || task.meta.phaseNumber == null) {
      continue;
    }

    const phase = task.meta.phaseNumber;
    const done = task.status === "done";
    phaseDone.set(phase, (phaseDone.get(phase) ?? false) || done);
  }

  if (phaseDone.size > 0) {
    return [...phaseDone.entries()]
      .filter(([, done]) => done)
      .map(([phase]) => phase)
      .sort((a, b) => a - b);
  }

  // Fallback: if phase lines are absent, treat a phase as done only when all
  // its plan tasks are done.
  const plansByPhase = new Map<number, { total: number; done: number }>();
  for (const task of tasks) {
    if (task.meta.phaseNumber == null || task.meta.taskType !== "plan") {
      continue;
    }

    const phase = task.meta.phaseNumber;
    const aggregate = plansByPhase.get(phase) ?? { total: 0, done: 0 };
    aggregate.total += 1;
    if (task.status === "done") aggregate.done += 1;
    plansByPhase.set(phase, aggregate);
  }

  return [...plansByPhase.entries()]
    .filter(([, aggregate]) => aggregate.total > 0 && aggregate.total === aggregate.done)
    .map(([phase]) => phase)
    .sort((a, b) => a - b);
}

export type PhaseCompletionHandler = (
  phase: number,
  snapshot: ClaimSnapshot,
) => void | Promise<void>;

export interface CompletionWatcher {
  stop(): void;
}

/**
 * Watch a workspace's GSD files for phase completion transitions.
 * When a phase changes from not-done to done, captures a ClaimSnapshot
 * and calls the handler.
 */
export function watchForCompletion(
  workspacePath: string,
  baseSha: string | undefined,
  onPhaseComplete: PhaseCompletionHandler,
): CompletionWatcher {
  const knownDone = new Set<number>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const watchers: FSWatcher[] = [];

  async function check() {
    const donePhases = await getDonePhases(workspacePath);

    for (const phase of donePhases) {
      if (knownDone.has(phase)) continue;
      knownDone.add(phase);
      const snapshot = await captureClaimSnapshot(workspacePath, phase, baseSha);
      await onPhaseComplete(phase, snapshot);
    }
  }

  function onChange() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      check().catch((err) => console.error("[completion-watcher] Error:", err));
    }, 500);
  }

  // Watch .planning/ directory
  const planningDir = join(workspacePath, ".planning");
  stat(planningDir)
    .then((s) => {
      if (s.isDirectory()) {
        const w = watch(planningDir, { recursive: true }, onChange);
        w.on("error", () => {});
        watchers.push(w);
      }
    })
    .catch(() => {});

  // Watch root STATE.md and PLAN.md
  for (const file of ["STATE.md", "PLAN.md"]) {
    const filePath = join(workspacePath, file);
    stat(filePath)
      .then(() => {
        const w = watch(filePath, onChange);
        w.on("error", () => {});
        watchers.push(w);
      })
      .catch(() => {});
  }

  // Initial check
  check().catch((err) => console.error("[completion-watcher] Initial check error:", err));

  return {
    stop() {
      if (debounceTimer) clearTimeout(debounceTimer);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

/**
 * One-shot: parse current GSD state and snapshot any phases already marked done.
 */
export async function checkCompletionOnce(
  workspacePath: string,
  baseSha?: string,
): Promise<{ phase: number; snapshot: ClaimSnapshot }[]> {
  const donePhases = await getDonePhases(workspacePath);
  const results: { phase: number; snapshot: ClaimSnapshot }[] = [];

  for (const phase of donePhases) {
    const snapshot = await captureClaimSnapshot(workspacePath, phase, baseSha);
    results.push({ phase, snapshot });
  }

  return results;
}
