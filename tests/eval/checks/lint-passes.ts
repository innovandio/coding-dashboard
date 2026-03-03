import { execFile } from "child_process";
import { promisify } from "util";
import type { AcceptanceCriterion, CheckContext, CheckHandler, CheckResult } from "../lib/types";

const execFileAsync = promisify(execFile);

export const lintPassesCheck: CheckHandler = {
  type: "lint_passes",

  async run(criterion: AcceptanceCriterion, context: CheckContext): Promise<CheckResult> {
    const start = performance.now();
    const command = (criterion.command as string) ?? "pnpm lint";
    const [cmd, ...args] = command.split(" ");

    try {
      await execFileAsync(cmd, args, {
        cwd: context.workspacePath,
        timeout: 60_000,
      });

      return {
        criterion_id: criterion.id,
        phase_ref: criterion.phase_ref,
        passed: true,
        message: `Lint passed: ${command}`,
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
        message: `Lint failed: ${command}`,
        duration_ms: performance.now() - start,
        attempt: 1,
        details: { output },
      };
    }
  },
};
