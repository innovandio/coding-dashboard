import type { EvalMetrics, PhaseVerdict } from "./types";

/**
 * Compute aggregate metrics from a set of phase verdicts.
 *
 * @param phases - The per-phase verdicts from an eval run
 * @param scaffoldTimestamp - ISO timestamp when the workspace was scaffolded
 */
export function computeMetrics(phases: PhaseVerdict[], scaffoldTimestamp?: string): EvalMetrics {
  const claimedDone = phases.filter((p) => p.claimed_done);
  const falseCompletions = claimedDone.filter((p) => p.verdict === "false_completion");

  const false_completion_rate =
    claimedDone.length > 0 ? falseCompletions.length / claimedDone.length : 0;

  // Time from scaffold to last phase marked done
  const claimTimes = claimedDone
    .map((p) => p.snapshot?.claimed_at)
    .filter(Boolean)
    .map((t) => new Date(t!).getTime());

  const scaffoldTime = scaffoldTimestamp
    ? new Date(scaffoldTimestamp).getTime()
    : Math.min(...claimTimes, Date.now());

  const lastClaimTime = claimTimes.length > 0 ? Math.max(...claimTimes) : scaffoldTime;
  const time_to_done = lastClaimTime - scaffoldTime;

  // Time to first all-green: use the latest claim time where all criteria pass,
  // or if counterfactual recovered, use the counterfactual completion time
  let time_to_first_all_green = time_to_done;
  const allGreenPhases = phases.filter(
    (p) => p.claimed_done && p.criteria_passed === p.criteria_total,
  );
  if (allGreenPhases.length === phases.filter((p) => p.claimed_done).length) {
    // All phases were legitimate — first all-green is time_to_done
    time_to_first_all_green = time_to_done;
  } else {
    // Some phases had failures — if counterfactual recovered, estimate extra time
    const recoveredPhases = phases.filter((p) => p.counterfactual?.recovered);
    if (recoveredPhases.length > 0) {
      // Rough estimate: add the counterfactual check durations
      const extraTime = recoveredPhases.reduce((sum, p) => {
        const afterDuration = p.counterfactual!.results_after.reduce(
          (s, r) => s + r.duration_ms,
          0,
        );
        return sum + afterDuration + 5000; // 5s estimate for agent work
      }, 0);
      time_to_first_all_green = time_to_done + extraTime;
    }
  }

  // Recovery rate: how many counterfactual reruns recovered?
  const counterfactualRuns = phases.filter((p) => p.counterfactual);
  const recoveredRuns = counterfactualRuns.filter((p) => p.counterfactual!.recovered);

  const recovery_after_prompt_rate =
    counterfactualRuns.length > 0 ? recoveredRuns.length / counterfactualRuns.length : 0;

  return {
    false_completion_rate,
    time_to_done,
    time_to_first_all_green,
    recovery_after_prompt_rate,
  };
}

/**
 * Aggregate metrics across multiple scenario runs.
 */
export function aggregateMetrics(runs: EvalMetrics[]): EvalMetrics {
  if (runs.length === 0) {
    return {
      false_completion_rate: 0,
      time_to_done: 0,
      time_to_first_all_green: 0,
      recovery_after_prompt_rate: 0,
    };
  }

  const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

  return {
    false_completion_rate: avg(runs.map((r) => r.false_completion_rate)),
    time_to_done: avg(runs.map((r) => r.time_to_done)),
    time_to_first_all_green: avg(runs.map((r) => r.time_to_first_all_green)),
    recovery_after_prompt_rate: avg(runs.map((r) => r.recovery_after_prompt_rate)),
  };
}
