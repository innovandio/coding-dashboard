import { execFile } from "child_process";
import { promisify } from "util";
import type { AcceptanceCriterion, CheckContext, CheckHandler, CheckResult } from "../lib/types";

const execFileAsync = promisify(execFile);

export const buildSucceedsCheck: CheckHandler = {
  type: "build_succeeds",

  async run(criterion: AcceptanceCriterion, context: CheckContext): Promise<CheckResult> {
    const start = performance.now();
    const command = (criterion.command as string) ?? "pnpm build";

    try {
      const { stderr } = await execFileAsync("sh", ["-c", command], {
        cwd: context.workspacePath,
        timeout: 120_000,
        env: { ...process.env, NODE_ENV: "production" },
      });

      return {
        criterion_id: criterion.id,
        phase_ref: criterion.phase_ref,
        passed: true,
        message: `Build succeeded: ${command}`,
        duration_ms: performance.now() - start,
        attempt: 1,
        details: stderr ? { stderr: stderr.slice(0, 2000) } : undefined,
      };
    } catch (err) {
      const error = err as { stderr?: string; message?: string };
      return {
        criterion_id: criterion.id,
        phase_ref: criterion.phase_ref,
        passed: false,
        message: `Build failed: ${command}`,
        duration_ms: performance.now() - start,
        attempt: 1,
        details: {
          stderr: (error.stderr ?? error.message ?? "").slice(0, 2000),
        },
      };
    }
  },
};
