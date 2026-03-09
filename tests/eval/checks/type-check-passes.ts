import { execFile } from "child_process";
import { promisify } from "util";
import type { AcceptanceCriterion, CheckContext, CheckHandler, CheckResult } from "../lib/types";

const execFileAsync = promisify(execFile);

export const typeCheckPassesCheck: CheckHandler = {
  type: "type_check_passes",

  async run(criterion: AcceptanceCriterion, context: CheckContext): Promise<CheckResult> {
    const start = performance.now();
    const command = (criterion.command as string) ?? "pnpm tsc --noEmit";

    try {
      await execFileAsync("sh", ["-c", command], {
        cwd: context.workspacePath,
        timeout: 60_000,
      });

      return {
        criterion_id: criterion.id,
        phase_ref: criterion.phase_ref,
        passed: true,
        message: `Type check passed: ${command}`,
        duration_ms: performance.now() - start,
        attempt: 1,
      };
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string };
      const output = (error.stdout ?? error.stderr ?? "").slice(0, 2000);
      return {
        criterion_id: criterion.id,
        phase_ref: criterion.phase_ref,
        passed: false,
        message: `Type check failed: ${command}`,
        duration_ms: performance.now() - start,
        attempt: 1,
        details: { output },
      };
    }
  },
};
