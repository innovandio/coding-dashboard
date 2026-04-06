import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type { EvalReport, PhaseVerdict, EvalMetrics } from "./types";

// ANSI colors for terminal output
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function verdictLabel(verdict: PhaseVerdict["verdict"]): string {
  switch (verdict) {
    case "legitimate":
      return `${c.green}LEGITIMATE${c.reset}`;
    case "false_completion":
      return `${c.red}FALSE COMPLETION${c.reset}`;
    case "not_claimed":
      return `${c.dim}NOT CLAIMED${c.reset}`;
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function printPhaseVerdict(phase: PhaseVerdict) {
  const icon = phase.claimed_done ? (phase.verdict === "legitimate" ? "+" : "x") : "-";
  console.log(
    `  ${c.bold}[${icon}] Phase ${phase.phase}${c.reset}  ` +
      `${phase.criteria_passed}/${phase.criteria_total} criteria  ` +
      verdictLabel(phase.verdict),
  );

  if (phase.criteria_failed.length > 0) {
    for (const id of phase.criteria_failed) {
      console.log(`      ${c.red}x${c.reset} ${id}`);
    }
  }

  if (phase.counterfactual) {
    const cf = phase.counterfactual;
    const diagLabel =
      cf.diagnosis === "early_stopping"
        ? `${c.yellow}EARLY STOPPING${c.reset}`
        : cf.diagnosis === "partial_recovery"
          ? `${c.yellow}PARTIAL RECOVERY${c.reset}`
          : `${c.red}CAPABILITY GAP${c.reset}`;

    const beforeFail = cf.results_before.filter((r) => !r.passed).length;
    const afterFail = cf.results_after.filter((r) => !r.passed).length;

    console.log(
      `      ${c.cyan}Counterfactual:${c.reset} ${diagLabel}  ` +
        `(${beforeFail} failing -> ${afterFail} failing)`,
    );
  }

  if (phase.snapshot) {
    console.log(
      `      ${c.dim}Claimed at: ${phase.snapshot.claimed_at}  ` +
        `SHA: ${phase.snapshot.git_sha.slice(0, 8)}  ` +
        `Files changed: ${phase.snapshot.files_changed.length}${c.reset}`,
    );
  }
}

function printMetrics(metrics: EvalMetrics) {
  console.log(`\n  ${c.bold}Metrics${c.reset}`);
  console.log(
    `    False completion rate:      ${metrics.false_completion_rate > 0 ? c.red : c.green}${pct(metrics.false_completion_rate)}${c.reset}`,
  );
  console.log(`    Time to done:               ${formatDuration(metrics.time_to_done)}`);
  console.log(`    Time to first all-green:    ${formatDuration(metrics.time_to_first_all_green)}`);
  console.log(
    `    Recovery after prompt rate:  ${metrics.recovery_after_prompt_rate > 0 ? c.yellow : c.dim}${pct(metrics.recovery_after_prompt_rate)}${c.reset}`,
  );
}

export function printReport(report: EvalReport) {
  console.log(`\n${c.bold}${c.blue}=== Eval Report: ${report.scenario} ===${c.reset}`);
  console.log(`  ${c.dim}${report.timestamp}${c.reset}\n`);

  for (const phase of report.phases) {
    printPhaseVerdict(phase);
  }

  printMetrics(report.metrics);

  if (report.reference_calibration) {
    const cal = report.reference_calibration;
    console.log(`\n  ${c.bold}Reference Calibration${c.reset}`);
    console.log(
      `    Known-good score: ${cal.known_good_score >= 0.95 ? c.green : c.red}${pct(cal.known_good_score)}${c.reset}`,
    );
    console.log(
      `    Known-bad score:  ${cal.known_bad_score <= 0.3 ? c.green : c.red}${pct(cal.known_bad_score)}${c.reset}`,
    );
  }

  console.log("");
}

/**
 * Export a report as JSON to disk.
 */
export async function exportReport(report: EvalReport, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const filename = `eval-${report.scenario.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}.json`;
  const filePath = join(outputDir, filename);
  await writeFile(filePath, JSON.stringify(report, null, 2));
  return filePath;
}

/**
 * Print a summary table for multiple scenario reports.
 */
export function printSummary(reports: EvalReport[]) {
  console.log(`\n${c.bold}${c.blue}=== Eval Suite Summary ===${c.reset}\n`);

  const maxName = Math.max(...reports.map((r) => r.scenario.length), 8);

  console.log(`  ${"Scenario".padEnd(maxName)}  FCR      Recovery  Phases  Verdict`);
  console.log(`  ${"─".repeat(maxName)}  ───────  ────────  ──────  ─────────`);

  for (const report of reports) {
    const m = report.metrics;
    const claimedPhases = report.phases.filter((phase) => phase.claimed_done);
    const totalPhases = claimedPhases.length;
    const falsePhases = claimedPhases.filter(
      (phase) => phase.verdict === "false_completion",
    ).length;

    const fcrColor = m.false_completion_rate > 0 ? c.red : c.green;
    const recColor = m.recovery_after_prompt_rate > 0 ? c.yellow : c.dim;
    const verdict =
      totalPhases === 0
        ? `${c.yellow}NO CLAIMS${c.reset}`
        : falsePhases === 0
          ? `${c.green}PASS${c.reset}`
          : `${c.red}FAIL${c.reset}`;

    console.log(
      `  ${report.scenario.padEnd(maxName)}  ` +
        `${fcrColor}${pct(m.false_completion_rate).padEnd(7)}${c.reset}  ` +
        `${recColor}${pct(m.recovery_after_prompt_rate).padEnd(8)}${c.reset}  ` +
        `${falsePhases}/${totalPhases}`.padEnd(6) +
        `  ${verdict}`,
    );
  }

  console.log("");
}
