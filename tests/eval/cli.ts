#!/usr/bin/env tsx
import { execFile } from "child_process";
import { parseArgs, promisify } from "util";
import {
  runAll,
  runAllLive,
  runOneLive,
  runPostHoc,
  runReferenceCalibration,
  runWatch,
} from "./lib/eval-runner";
import type { CounterfactualOptions } from "./lib/counterfactual";

const execFileAsync = promisify(execFile);

const { values } = parseArgs({
  options: {
    scenario: { type: "string", short: "s" },
    workspace: { type: "string", short: "w" },
    watch: { type: "boolean", default: false },
    counterfactual: { type: "boolean", default: false },
    "counterfactual-cmd": { type: "string" },
    "counterfactual-timeout-ms": { type: "string" },
    "reference-check": { type: "boolean", default: false },
    "full-reference-check": { type: "boolean", default: false },
    all: { type: "boolean", default: false },
    "all-live": { type: "boolean", default: false },
    "base-url": { type: "string" },
    "dashboard-url": { type: "string" },
    "auth-cookie": { type: "string" },
    timeout: { type: "string" },
    "output-dir": { type: "string", short: "o" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

function printUsage() {
  console.log(`
Completion Verification Eval Framework
=======================================

Usage:
  pnpm eval --scenario <name> --workspace <path>   Post-hoc verification
  pnpm eval --watch --workspace <path>              Watch mode (continuous)
  pnpm eval --watch --counterfactual --counterfactual-cmd <cmd> --workspace <path>
  pnpm eval --all                                   Full eval suite
  pnpm eval --all-live --auth-cookie <cookie>      Live eval suite via dashboard API
  pnpm eval --all-live --scenario <name> --auth-cookie <cookie>  Single scenario live
  pnpm eval --reference-check --scenario <name>     Calibrate criteria
  pnpm eval --reference-check --all                 Calibrate all scenarios

Options:
  -s, --scenario <name>       Scenario file name (without extension)
  -w, --workspace <path>      Path to the workspace to evaluate
  --watch                     Watch GSD files for completion transitions
  --counterfactual            After failed claims, send follow-up prompt and rerun
  --counterfactual-cmd <cmd>  Command to run follow-up solving step (uses EVAL_COUNTERFACTUAL_PROMPT env var)
  --counterfactual-timeout-ms <ms>  Timeout for counterfactual command (default: 300000)
  --reference-check           Run criteria against known-good/bad references
  --full-reference-check      Include runtime checks during reference calibration
  --all                       Run all scenarios
  --all-live                  Run all scenarios in live solver mode (dashboard + gateway required)
  --base-url <url>            Base URL for HTTP and browser checks
  --dashboard-url <url>       Dashboard base URL for live mode (default: http://localhost:3000)
  --auth-cookie <cookie>      Auth cookie for protected dashboard APIs in live mode
  --timeout <seconds>         Per-scenario timeout in seconds for live mode (default: 300)
  -o, --output-dir <path>     Directory to save JSON reports
  -h, --help                  Show this help
`);
}

function parseTimeout(raw: string | undefined): number {
  if (!raw) return 300_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --counterfactual-timeout-ms value: '${raw}'`);
  }
  return Math.floor(parsed);
}

function createCounterfactualOptions(command: string, timeoutMs: number): CounterfactualOptions {
  return {
    timeout: timeoutMs,
    async sendPromptAndWait(prompt: string) {
      console.log("\n  Sending counterfactual prompt via command...");
      await execFileAsync("sh", ["-lc", command], {
        env: {
          ...process.env,
          EVAL_COUNTERFACTUAL_PROMPT: prompt,
        },
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });
    },
  };
}

async function main() {
  if (values.help) {
    printUsage();
    process.exit(0);
  }

  const outputDir = values["output-dir"];
  const baseUrl = values["base-url"];
  const dashboardUrl = values["dashboard-url"] ?? "http://localhost:3000";
  const fullReferenceCheck = values["full-reference-check"];
  const timeoutSecRaw = values.timeout;
  const timeoutSec = timeoutSecRaw ? Number(timeoutSecRaw) : 300;
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
    throw new Error(`Invalid --timeout value: '${timeoutSecRaw}'`);
  }

  const authCookie = values["auth-cookie"] ?? process.env.EVAL_AUTH_COOKIE;

  // Mode 5: Reference calibration
  if (values["reference-check"]) {
    if (values.all) {
      const { loadAllScenarios } = await import("./lib/scenario-loader");
      const scenarios = await loadAllScenarios();
      for (const scenario of scenarios) {
        console.log(`\nCalibrating: ${scenario.name}`);
        await runReferenceCalibration(scenario.id, {
          baseUrl,
          fullCriteria: fullReferenceCheck,
        });
      }
    } else if (values.scenario) {
      await runReferenceCalibration(values.scenario, {
        baseUrl,
        fullCriteria: fullReferenceCheck,
      });
    } else {
      console.error("Error: --reference-check requires --scenario or --all");
      process.exit(1);
    }
    return;
  }

  // Mode 4: Live eval suite (all scenarios, or single with --scenario)
  if (values["all-live"]) {
    if (!authCookie) {
      console.error("Error: --all-live requires --auth-cookie <cookie> or EVAL_AUTH_COOKIE");
      process.exit(1);
    }

    if (values.scenario) {
      await runOneLive(values.scenario, {
        dashboardUrl,
        authCookie,
        timeoutSec: Math.floor(timeoutSec),
        outputDir,
      });
    } else {
      await runAllLive({
        dashboardUrl,
        authCookie,
        timeoutSec: Math.floor(timeoutSec),
        outputDir,
      });
    }
    return;
  }

  // Mode 4: Full eval suite (static)
  if (values.all) {
    await runAll({ baseUrl, outputDir });
    return;
  }

  // Modes 1-3 require --scenario and --workspace
  if (!values.scenario) {
    console.error("Error: --scenario is required (or use --all)");
    printUsage();
    process.exit(1);
  }

  if (!values.workspace) {
    console.error("Error: --workspace is required");
    printUsage();
    process.exit(1);
  }

  // Mode 2/3: Watch mode
  if (values.watch) {
    let counterfactualOptions: CounterfactualOptions | undefined;

    if (values.counterfactual) {
      const counterfactualCmd = values["counterfactual-cmd"];
      if (!counterfactualCmd) {
        console.error("Error: --counterfactual requires --counterfactual-cmd <cmd>");
        process.exit(1);
      }
      counterfactualOptions = createCounterfactualOptions(
        counterfactualCmd,
        parseTimeout(values["counterfactual-timeout-ms"]),
      );
    }

    await runWatch(values.scenario, values.workspace, {
      baseUrl,
      counterfactual: values.counterfactual,
      counterfactualOptions,
      outputDir,
    });
    return;
  }

  // Mode 1: Post-hoc verification
  await runPostHoc(values.scenario, values.workspace, {
    baseUrl,
    outputDir,
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
