import { execFile } from "child_process";
import { mkdtemp, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { chromium, type Browser } from "@playwright/test";
import { checkCompletionOnce, watchForCompletion } from "./completion-watcher";
import { runCounterfactual, type CounterfactualOptions } from "./counterfactual";
import { computeMetrics } from "./metrics";
import { exportReport, printReport, printSummary } from "./reporter";
import { loadAllScenarios, loadScenarioByName } from "./scenario-loader";
import { runAllCriteria, runReferenceCheck } from "./verification-engine";
import { copyReference, scaffoldWorkspace } from "./workspace-scaffold";
import { startAppServer } from "./app-server";
import { GatewayClient } from "./gateway-client";
import type {
  AcceptanceCriterion,
  CheckContext,
  ClaimSnapshot,
  EvalReport,
  PhaseVerdict,
  ReferenceCalibration,
  Scenario,
} from "./types";

const execFileAsync = promisify(execFile);
const BROWSER_CHECK_TYPES = new Set(["browser_visible", "browser_interaction"]);
const STATIC_REFERENCE_CHECK_TYPES = new Set([
  "file_exists",
  "file_not_exists",
  "content_matches",
  "content_not_matches",
  "content_matches_glob",
  "content_not_matches_glob",
]);

async function resolveBaseSha(workspacePath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: workspacePath,
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

function scenarioNeedsBrowser(scenario: Scenario): boolean {
  return scenario.acceptance_criteria.some((criterion) => BROWSER_CHECK_TYPES.has(criterion.type));
}

async function createBrowserIfNeeded(
  scenario: Scenario,
  baseUrl?: string,
): Promise<Browser | undefined> {
  if (!baseUrl) return undefined;
  if (!scenarioNeedsBrowser(scenario)) return undefined;
  return chromium.launch({ headless: true });
}

function buildPhaseVerdict(
  scenario: Scenario,
  phase: number,
  snapshot: ClaimSnapshot | null,
  results: Awaited<ReturnType<typeof runAllCriteria>>,
): PhaseVerdict {
  const phaseCriteria = scenario.acceptance_criteria.filter(
    (criterion) => criterion.phase_ref === phase,
  );
  const phaseResults = results.filter((result) => result.phase_ref === phase);
  const criteria_passed = phaseResults.filter((result) => result.passed).length;
  const criteria_failed = phaseResults
    .filter((result) => !result.passed)
    .map((result) => result.criterion_id);

  return {
    phase,
    claimed_done: snapshot !== null,
    snapshot,
    criteria_total: phaseCriteria.length,
    criteria_passed,
    criteria_failed,
    verdict:
      snapshot === null
        ? "not_claimed"
        : criteria_failed.length === 0
          ? "legitimate"
          : "false_completion",
  };
}

function getReferenceCalibrationCriteria(scenario: Scenario, fullCriteria: boolean) {
  if (fullCriteria) return scenario.acceptance_criteria;
  return scenario.acceptance_criteria.filter((criterion) =>
    STATIC_REFERENCE_CHECK_TYPES.has(criterion.type),
  );
}

function isRuntimeCriterion(criterion: AcceptanceCriterion): boolean {
  return criterion.type === "http_request" || BROWSER_CHECK_TYPES.has(criterion.type);
}

async function runReferenceCriteria(
  criteria: AcceptanceCriterion[],
  referencePath: string,
  options: { baseUrl?: string; browser?: Browser },
): Promise<{
  passRate: number;
  results: Awaited<ReturnType<typeof runReferenceCheck>>["results"];
}> {
  if (options.baseUrl || !criteria.some(isRuntimeCriterion)) {
    return runReferenceCheck(criteria, referencePath, {
      baseUrl: options.baseUrl,
      browser: options.browser,
    });
  }

  const runtimeCriteria = criteria.filter(isRuntimeCriterion);
  const staticCriteria = criteria.filter((criterion) => !isRuntimeCriterion(criterion));

  const combinedResults: Awaited<ReturnType<typeof runReferenceCheck>>["results"] = [];

  if (staticCriteria.length > 0) {
    const staticResult = await runReferenceCheck(staticCriteria, referencePath, {
      browser: options.browser,
    });
    combinedResults.push(...staticResult.results);
  }

  if (runtimeCriteria.length > 0) {
    const appServer = await startAppServer({ workspacePath: referencePath });
    try {
      const runtimeResult = await runReferenceCheck(runtimeCriteria, referencePath, {
        baseUrl: appServer.baseUrl,
        browser: options.browser,
      });
      combinedResults.push(...runtimeResult.results);
    } finally {
      await appServer.stop().catch(() => {});
    }
  }

  const passed = combinedResults.filter((result) => result.passed).length;
  return {
    passRate: combinedResults.length > 0 ? passed / combinedResults.length : 0,
    results: combinedResults,
  };
}

function createNoClaimsReport(scenario: Scenario, scaffoldTimestamp?: string): EvalReport {
  const phases: PhaseVerdict[] = scenario.gsd_tasks.map((task) => ({
    phase: task.phase,
    claimed_done: false,
    snapshot: null,
    criteria_total: scenario.acceptance_criteria.filter((c) => c.phase_ref === task.phase).length,
    criteria_passed: 0,
    criteria_failed: [],
    verdict: "not_claimed",
  }));

  return {
    scenario: scenario.name,
    timestamp: new Date().toISOString(),
    phases,
    metrics: computeMetrics(phases, scaffoldTimestamp),
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function buildScenarioPrompt(scenario: Scenario): string {
  const tasks = scenario.gsd_tasks
    .map((phase) => {
      const lines = phase.plans.map((plan) => `- ${plan}`).join("\n");
      return `Phase ${phase.phase}: ${phase.title}\n${lines}`;
    })
    .join("\n\n");

  return [
    `Scenario: ${scenario.name}`,
    "",
    `Description: ${scenario.description}`,
    "",
    "Implement the requested work in this workspace.",
    "Mark phases done only after verifying behavior with tests/checks.",
    "",
    "GSD Tasks:",
    tasks,
  ].join("\n");
}

export async function runPostHoc(
  scenarioName: string,
  workspacePath: string,
  options?: { baseUrl?: string; outputDir?: string },
): Promise<EvalReport> {
  const scenario = await loadScenarioByName(scenarioName);
  const baseSha = await resolveBaseSha(workspacePath);
  const browser = await createBrowserIfNeeded(scenario, options?.baseUrl);
  const context: CheckContext = {
    workspacePath,
    baseUrl: options?.baseUrl,
    browser,
  };

  try {
    const completions = await checkCompletionOnce(workspacePath, baseSha);
    const snapshotMap = new Map(
      completions.map((completion) => [completion.phase, completion.snapshot]),
    );

    const results = await runAllCriteria(scenario.acceptance_criteria, context);
    const phases = scenario.gsd_tasks.map((task) =>
      buildPhaseVerdict(scenario, task.phase, snapshotMap.get(task.phase) ?? null, results),
    );

    const report: EvalReport = {
      scenario: scenario.name,
      timestamp: new Date().toISOString(),
      phases,
      metrics: computeMetrics(phases),
    };

    printReport(report);

    if (options?.outputDir) {
      const filePath = await exportReport(report, options.outputDir);
      console.log(`  Report saved to: ${filePath}\n`);
    }

    return report;
  } finally {
    await browser?.close();
  }
}

export async function runWatch(
  scenarioName: string,
  workspacePath: string,
  options?: {
    baseUrl?: string;
    counterfactual?: boolean;
    counterfactualOptions?: CounterfactualOptions;
    outputDir?: string;
    baseSha?: string;
  },
): Promise<EvalReport> {
  const scenario = await loadScenarioByName(scenarioName);

  if (options?.counterfactual && !scenario.counterfactual_prompt) {
    throw new Error(`Scenario '${scenario.id}' does not define counterfactual_prompt.`);
  }
  if (options?.counterfactual && !options.counterfactualOptions) {
    throw new Error("--counterfactual was requested but no counterfactualOptions were provided.");
  }

  const baseSha = options?.baseSha ?? (await resolveBaseSha(workspacePath));
  const browser = await createBrowserIfNeeded(scenario, options?.baseUrl);
  const context: CheckContext = {
    workspacePath,
    baseUrl: options?.baseUrl,
    browser,
  };

  const scaffoldTimestamp = new Date().toISOString();
  const phaseVerdicts = new Map<number, PhaseVerdict>();

  return new Promise((resolve, reject) => {
    const watcher = watchForCompletion(workspacePath, baseSha, async (phase, snapshot) => {
      try {
        console.log(`\n  Phase ${phase} claimed done — running checks...`);

        const results = await runAllCriteria(scenario.acceptance_criteria, context, {
          phaseFilter: phase,
        });
        let verdict = buildPhaseVerdict(scenario, phase, snapshot, results);

        if (verdict.verdict === "false_completion" && options?.counterfactual) {
          console.log(`  Running counterfactual for phase ${phase}...`);
          const counterfactual = await runCounterfactual(
            phase,
            scenario.counterfactual_prompt!,
            scenario.acceptance_criteria,
            context,
            results,
            options.counterfactualOptions!,
          );
          verdict = { ...verdict, counterfactual };
        }

        phaseVerdicts.set(phase, verdict);

        const allPhasesEvaluated = scenario.gsd_tasks.every((task) =>
          phaseVerdicts.has(task.phase),
        );
        if (!allPhasesEvaluated) return;

        watcher.stop();

        const phases = scenario.gsd_tasks.map((task) => phaseVerdicts.get(task.phase)!);
        const report: EvalReport = {
          scenario: scenario.name,
          timestamp: new Date().toISOString(),
          phases,
          metrics: computeMetrics(phases, scaffoldTimestamp),
        };

        printReport(report);
        if (options?.outputDir) {
          const filePath = await exportReport(report, options.outputDir);
          console.log(`  Report saved to: ${filePath}\n`);
        }

        await browser?.close();
        resolve(report);
      } catch (error) {
        watcher.stop();
        await browser?.close();
        reject(error);
      }
    });
  });
}

export async function runAll(options?: {
  baseUrl?: string;
  outputDir?: string;
}): Promise<EvalReport[]> {
  const scenarios = await loadAllScenarios();
  const reports: EvalReport[] = [];

  for (const scenario of scenarios) {
    console.log(`\n  Scaffolding scenario: ${scenario.name}...`);

    const tempDir = await mkdtemp(join(tmpdir(), "eval-"));
    const { workspacePath, baseSha } = await scaffoldWorkspace(scenario, tempDir);
    const browser = await createBrowserIfNeeded(scenario, options?.baseUrl);
    const context: CheckContext = {
      workspacePath,
      baseUrl: options?.baseUrl,
      browser,
    };

    try {
      const completions = await checkCompletionOnce(workspacePath, baseSha);
      const snapshotMap = new Map(
        completions.map((completion) => [completion.phase, completion.snapshot]),
      );
      const results = await runAllCriteria(scenario.acceptance_criteria, context);

      const phases = scenario.gsd_tasks.map((task) =>
        buildPhaseVerdict(scenario, task.phase, snapshotMap.get(task.phase) ?? null, results),
      );

      const report: EvalReport = {
        scenario: scenario.name,
        timestamp: new Date().toISOString(),
        phases,
        metrics: computeMetrics(phases),
      };

      printReport(report);
      reports.push(report);

      if (options?.outputDir) {
        await exportReport(report, options.outputDir);
      }
    } finally {
      await browser?.close();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  printSummary(reports);
  return reports;
}

async function runScenarioLive(
  scenario: Scenario,
  gatewayClient: GatewayClient,
  runRoot: string,
  timeoutMs: number,
  outputDir?: string,
): Promise<EvalReport> {
  const scenarioWorkspace = join(runRoot, scenario.id);
  const scaffoldTimestamp = new Date().toISOString();

  let projectId: string | null = null;
  let sessionKey: string | null = null;
  let browser: Browser | undefined;
  let appServer: Awaited<ReturnType<typeof startAppServer>> | undefined;
  let watcher: ReturnType<typeof watchForCompletion> | null = null;

  const phaseVerdicts = new Map<number, PhaseVerdict>();
  const snapshotMap = new Map<number, ClaimSnapshot>();

  try {
    console.log(`\n  [live] Scaffolding scenario: ${scenario.name}...`);
    const scaffold = await scaffoldWorkspace(scenario, scenarioWorkspace);

    appServer = await startAppServer({ workspacePath: scenarioWorkspace });
    browser = await createBrowserIfNeeded(scenario, appServer.baseUrl);

    const context: CheckContext = {
      workspacePath: scenarioWorkspace,
      baseUrl: appServer.baseUrl,
      browser,
    };

    projectId = `eval-${slugify(scenario.id)}-${Date.now()}`;
    console.log(`  [live] Creating project ${projectId}...`);
    await gatewayClient.createProject({
      agentId: projectId,
      name: `Eval ${scenario.name}`,
      workspace: scenarioWorkspace,
    });
    await gatewayClient.checkHealth();

    const session = await gatewayClient.createSession(projectId);
    sessionKey = session.sessionKey;

    watcher = watchForCompletion(scenarioWorkspace, scaffold.baseSha, async (phase, snapshot) => {
      snapshotMap.set(phase, snapshot);
      const phaseResults = await runAllCriteria(scenario.acceptance_criteria, context, {
        phaseFilter: phase,
      });
      phaseVerdicts.set(phase, buildPhaseVerdict(scenario, phase, snapshot, phaseResults));
    });

    await gatewayClient.sendMessage({
      sessionId: session.sessionId,
      sessionKey: session.sessionKey,
      message: buildScenarioPrompt(scenario),
    });

    try {
      await gatewayClient.waitForLifecycleEnd({ projectId, timeoutMs });
    } catch (err) {
      console.warn(
        `  [live] Scenario '${scenario.name}' timed out waiting for lifecycle end: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (sessionKey) {
        await gatewayClient.abortSession(sessionKey).catch(() => {});
      }
    }

    watcher.stop();
    watcher = null;

    const completions = await checkCompletionOnce(scenarioWorkspace, scaffold.baseSha);
    for (const completion of completions) {
      if (!snapshotMap.has(completion.phase)) {
        snapshotMap.set(completion.phase, completion.snapshot);
      }
    }

    const results = await runAllCriteria(scenario.acceptance_criteria, context);
    const phases = scenario.gsd_tasks.map((task) => {
      const existingVerdict = phaseVerdicts.get(task.phase);
      if (existingVerdict) return existingVerdict;

      return buildPhaseVerdict(scenario, task.phase, snapshotMap.get(task.phase) ?? null, results);
    });

    const report: EvalReport = {
      scenario: scenario.name,
      timestamp: new Date().toISOString(),
      phases,
      metrics: computeMetrics(phases, scaffoldTimestamp),
    };

    printReport(report);
    if (outputDir) {
      const filePath = await exportReport(report, outputDir);
      console.log(`  Report saved to: ${filePath}\n`);
    }

    return report;
  } catch (error) {
    console.error(
      `  [live] Scenario '${scenario.name}' failed: ${error instanceof Error ? error.message : String(error)}`,
    );

    const report = createNoClaimsReport(scenario, scaffoldTimestamp);
    printReport(report);
    if (outputDir) {
      await exportReport(report, outputDir);
    }
    return report;
  } finally {
    if (watcher) watcher.stop();
    await browser?.close().catch(() => {});

    if (sessionKey) {
      await gatewayClient.abortSession(sessionKey).catch(() => {});
    }

    if (projectId) {
      await gatewayClient.deleteProject(projectId).catch((err) => {
        console.warn(
          `  [live] Failed to delete project '${projectId}': ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }

    await appServer?.stop().catch(() => {});
    await rm(scenarioWorkspace, { recursive: true, force: true }).catch(() => {});
  }
}

export async function runOneLive(
  scenarioName: string,
  options: {
    dashboardUrl: string;
    authCookie: string;
    timeoutSec?: number;
    outputDir?: string;
  },
): Promise<EvalReport> {
  const scenario = await loadScenarioByName(scenarioName);
  const timeoutMs = (options.timeoutSec ?? 300) * 1000;
  const runRoot = join(process.cwd(), "tests", "eval", ".eval-runs", `run-${Date.now()}`);
  await mkdir(runRoot, { recursive: true });

  const gatewayClient = new GatewayClient({
    dashboardUrl: options.dashboardUrl,
    authCookie: options.authCookie,
  });
  await gatewayClient.checkHealth();

  return runScenarioLive(scenario, gatewayClient, runRoot, timeoutMs, options.outputDir);
}

export async function runAllLive(options: {
  dashboardUrl: string;
  authCookie: string;
  timeoutSec?: number;
  outputDir?: string;
}): Promise<EvalReport[]> {
  const scenarios = await loadAllScenarios();
  const reports: EvalReport[] = [];
  const timeoutMs = (options.timeoutSec ?? 300) * 1000;
  const runRoot = join(process.cwd(), "tests", "eval", ".eval-runs", `run-${Date.now()}`);
  await mkdir(runRoot, { recursive: true });

  const gatewayClient = new GatewayClient({
    dashboardUrl: options.dashboardUrl,
    authCookie: options.authCookie,
  });
  await gatewayClient.checkHealth();

  for (const scenario of scenarios) {
    const report = await runScenarioLive(
      scenario,
      gatewayClient,
      runRoot,
      timeoutMs,
      options.outputDir,
    );
    reports.push(report);
  }

  printSummary(reports);
  return reports;
}

export async function runReferenceCalibration(
  scenarioName: string,
  options?: { baseUrl?: string; fullCriteria?: boolean },
): Promise<ReferenceCalibration | null> {
  const scenario = await loadScenarioByName(scenarioName);
  const criteria = getReferenceCalibrationCriteria(scenario, options?.fullCriteria ?? false);

  if (criteria.length === 0) {
    console.log("  No calibration-friendly criteria found for this scenario.\n");
    return null;
  }

  if (!scenario.reference_good && !scenario.reference_bad) {
    console.log("  No reference implementations defined for this scenario.\n");
    return null;
  }

  const needsRuntimeChecks = criteria.some(
    (criterion) => criterion.type === "http_request" || BROWSER_CHECK_TYPES.has(criterion.type),
  );
  const needsBrowserChecks = criteria.some((criterion) => BROWSER_CHECK_TYPES.has(criterion.type));

  if (!(options?.fullCriteria ?? false)) {
    console.log(`  Running static calibration against ${criteria.length} file/content criteria...`);
  } else if (!options?.baseUrl && needsRuntimeChecks) {
    console.log(
      "  Full calibration has runtime checks and no --base-url was provided. Using per-reference local app servers.",
    );
  }

  let known_good_score = 0;
  let known_bad_score = 0;
  const browser = needsBrowserChecks ? await chromium.launch({ headless: true }) : undefined;

  try {
    if (scenario.reference_good) {
      console.log("  Checking known-good reference...");
      const tempDir = await mkdtemp(join(tmpdir(), "eval-ref-good-"));
      await scaffoldWorkspace(scenario, tempDir);
      await copyReference(scenario.reference_good, tempDir);

      try {
        const result = await runReferenceCriteria(criteria, tempDir, {
          baseUrl: options?.baseUrl,
          browser,
        });
        known_good_score = result.passRate;
        console.log(`  Known-good: ${(known_good_score * 100).toFixed(1)}% pass rate`);

        if (known_good_score < 0.95) {
          console.log("  WARNING: Known-good reference fails calibration criteria.");
          for (const failed of result.results.filter((check) => !check.passed)) {
            console.log(`    FAIL: ${failed.criterion_id} — ${failed.message}`);
          }
        }
      } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }

    if (scenario.reference_bad) {
      console.log("  Checking known-bad reference...");
      const tempDir = await mkdtemp(join(tmpdir(), "eval-ref-bad-"));
      await scaffoldWorkspace(scenario, tempDir);
      await copyReference(scenario.reference_bad, tempDir);

      try {
        const result = await runReferenceCriteria(criteria, tempDir, {
          baseUrl: options?.baseUrl,
          browser,
        });
        known_bad_score = result.passRate;
        console.log(`  Known-bad: ${(known_bad_score * 100).toFixed(1)}% pass rate`);

        if (known_bad_score > 0.6) {
          console.log("  WARNING: Known-bad reference passes too many calibration criteria.");
        }
      } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  } finally {
    await browser?.close();
  }

  console.log("");
  return {
    known_good_score,
    known_bad_score,
  };
}
