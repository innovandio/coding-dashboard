import { runAllCriteria } from "./verification-engine";
import type {
  AcceptanceCriterion,
  CheckContext,
  CheckResult,
  CounterfactualDiagnosis,
  CounterfactualResult,
} from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CounterfactualOptions {
  /** Function that sends a message to the agent and waits for it to finish */
  sendPromptAndWait: (prompt: string) => Promise<void>;
  /** Max time to wait for agent to finish after sending prompt (ms) */
  timeout?: number;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => {
            reject(new Error(`Counterfactual prompt timed out after ${timeoutMs}ms`));
          },
          { once: true },
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function diagnose(
  resultsBefore: CheckResult[],
  resultsAfter: CheckResult[],
): CounterfactualDiagnosis {
  const failedBefore = new Set(resultsBefore.filter((r) => !r.passed).map((r) => r.criterion_id));
  const failedAfter = new Set(resultsAfter.filter((r) => !r.passed).map((r) => r.criterion_id));

  if (failedAfter.size === 0) return "early_stopping";

  const recovered = [...failedBefore].filter((id) => !failedAfter.has(id));
  if (recovered.length > 0) return "partial_recovery";

  return "capability_gap";
}

/**
 * After a phase's criteria fail at claim time, run the counterfactual:
 * send a follow-up prompt to the agent, wait for it to finish,
 * then re-run checks and compare.
 */
export async function runCounterfactual(
  phase: number,
  prompt: string,
  criteria: AcceptanceCriterion[],
  context: CheckContext,
  resultsBefore: CheckResult[],
  options: CounterfactualOptions,
): Promise<CounterfactualResult> {
  await withTimeout(options.sendPromptAndWait(prompt), options.timeout);

  // Brief pause for file system sync
  await sleep(500);

  const resultsAfter = await runAllCriteria(criteria, context, {
    phaseFilter: phase,
  });

  const allPreviouslyFailedNowPass = resultsBefore
    .filter((r) => !r.passed)
    .every((before) => {
      const after = resultsAfter.find((r) => r.criterion_id === before.criterion_id);
      return after?.passed === true;
    });

  return {
    phase,
    prompt_sent: prompt,
    results_before: resultsBefore,
    results_after: resultsAfter,
    recovered: allPreviouslyFailedNowPass,
    diagnosis: diagnose(resultsBefore, resultsAfter),
  };
}
