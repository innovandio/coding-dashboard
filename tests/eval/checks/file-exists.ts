import { access } from "fs/promises";
import { join } from "path";
import type { AcceptanceCriterion, CheckContext, CheckHandler, CheckResult } from "../lib/types";

export const fileExistsCheck: CheckHandler = {
  type: "file_exists",

  async run(criterion: AcceptanceCriterion, context: CheckContext): Promise<CheckResult> {
    const start = performance.now();
    const relativePath = criterion.path as string;
    const fullPath = join(context.workspacePath, relativePath);

    try {
      await access(fullPath);
      return {
        criterion_id: criterion.id,
        phase_ref: criterion.phase_ref,
        passed: true,
        message: `File exists: ${relativePath}`,
        duration_ms: performance.now() - start,
        attempt: 1,
      };
    } catch {
      return {
        criterion_id: criterion.id,
        phase_ref: criterion.phase_ref,
        passed: false,
        message: `File not found: ${relativePath}`,
        duration_ms: performance.now() - start,
        attempt: 1,
      };
    }
  },
};

export const fileNotExistsCheck: CheckHandler = {
  type: "file_not_exists",

  async run(criterion: AcceptanceCriterion, context: CheckContext): Promise<CheckResult> {
    const start = performance.now();
    const relativePath = criterion.path as string;
    const fullPath = join(context.workspacePath, relativePath);

    try {
      await access(fullPath);
      return {
        criterion_id: criterion.id,
        phase_ref: criterion.phase_ref,
        passed: false,
        message: `File should not exist but does: ${relativePath}`,
        duration_ms: performance.now() - start,
        attempt: 1,
      };
    } catch {
      return {
        criterion_id: criterion.id,
        phase_ref: criterion.phase_ref,
        passed: true,
        message: `File correctly absent: ${relativePath}`,
        duration_ms: performance.now() - start,
        attempt: 1,
      };
    }
  },
};
