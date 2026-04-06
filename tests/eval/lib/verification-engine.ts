import { getCheckHandler } from "../checks/index";
import type { AcceptanceCriterion, CheckContext, CheckResult, RetryConfig } from "./types";

const DEFAULT_RETRY_TYPES = new Set(["http_request", "browser_visible", "browser_interaction"]);

const DEFAULT_RETRY: RetryConfig = { attempts: 2, delay_ms: 1000 };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryConfig(criterion: AcceptanceCriterion): RetryConfig {
  if (criterion.retry) return criterion.retry;
  if (DEFAULT_RETRY_TYPES.has(criterion.type)) return DEFAULT_RETRY;
  return { attempts: 1, delay_ms: 0 };
}

/**
 * Run a single criterion with retries.
 */
export async function runCriterion(
  criterion: AcceptanceCriterion,
  context: CheckContext,
): Promise<CheckResult> {
  const handler = getCheckHandler(criterion.type);
  if (!handler) {
    return {
      criterion_id: criterion.id,
      phase_ref: criterion.phase_ref,
      passed: false,
      message: `Unknown check type: ${criterion.type}`,
      duration_ms: 0,
      attempt: 0,
    };
  }

  const retry = getRetryConfig(criterion);
  let lastResult: CheckResult | null = null;

  for (let attempt = 1; attempt <= retry.attempts; attempt++) {
    const result = await handler.run(criterion, context);
    result.attempt = attempt;
    lastResult = result;

    if (result.passed) return result;

    if (attempt < retry.attempts) {
      await sleep(retry.delay_ms);
    }
  }

  return lastResult!;
}

/**
 * Run all criteria and collect results. Optionally filter by phase.
 */
export async function runAllCriteria(
  criteria: AcceptanceCriterion[],
  context: CheckContext,
  options?: { phaseFilter?: number },
): Promise<CheckResult[]> {
  const filtered =
    options?.phaseFilter != null
      ? criteria.filter((c) => c.phase_ref === options.phaseFilter)
      : criteria;

  const results: CheckResult[] = [];
  for (const criterion of filtered) {
    results.push(await runCriterion(criterion, context));
  }
  return results;
}

/**
 * Run criteria against a reference implementation directory.
 * Returns the pass rate (0–1).
 */
export async function runReferenceCheck(
  criteria: AcceptanceCriterion[],
  referencePath: string,
  options?: { baseUrl?: string; browser?: unknown; phaseFilter?: number },
): Promise<{ passRate: number; results: CheckResult[] }> {
  const context: CheckContext = {
    workspacePath: referencePath,
    baseUrl: options?.baseUrl,
    browser: options?.browser,
  };

  const results = await runAllCriteria(criteria, context, {
    phaseFilter: options?.phaseFilter,
  });
  const passed = results.filter((r) => r.passed).length;
  return {
    passRate: results.length > 0 ? passed / results.length : 0,
    results,
  };
}
