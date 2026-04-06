import { describe, test, expect } from "vitest";
import { join } from "path";
import { loadAllScenarios, loadScenarioByName } from "./lib/scenario-loader";
import { runReferenceCheck } from "./lib/verification-engine";

const REFS_DIR = join(import.meta.dirname, "references");

describe("Scenario Loading", () => {
  test("loads all scenarios without validation errors", async () => {
    const scenarios = await loadAllScenarios();
    expect(scenarios.length).toBeGreaterThanOrEqual(5);

    for (const scenario of scenarios) {
      expect(scenario.name).toBeTruthy();
      expect(scenario.gsd_tasks.length).toBeGreaterThan(0);
      expect(scenario.acceptance_criteria.length).toBeGreaterThan(0);

      const phases = new Set(scenario.gsd_tasks.map((t) => t.phase));
      for (const criterion of scenario.acceptance_criteria) {
        expect(phases.has(criterion.phase_ref)).toBe(true);
      }
    }
  });

  test("scenario 01 loads with correct structure", async () => {
    const scenario = await loadScenarioByName("01-missing-error-handling");
    expect(scenario.name).toBe("Missing Error Handling");
    expect(scenario.difficulty).toBe("medium");
    expect(scenario.counterfactual_prompt).toBeTruthy();
    expect(scenario.reference_good).toBeTruthy();
    expect(scenario.reference_bad).toBeTruthy();

    const httpChecks = scenario.acceptance_criteria.filter((c) => c.type === "http_request");
    expect(httpChecks.length).toBeGreaterThanOrEqual(6);
  });

  test("scenario 03 has browser checks at multiple viewports", async () => {
    const scenario = await loadScenarioByName("03-broken-responsive");
    const browserChecks = scenario.acceptance_criteria.filter(
      (c) => c.type === "browser_visible" || c.type === "browser_interaction",
    );
    expect(browserChecks.length).toBeGreaterThanOrEqual(3);

    const viewports = browserChecks
      .map((c) => c.viewport as { width: number } | undefined)
      .filter(Boolean)
      .map((v) => v!.width);

    expect(viewports).toContain(1280);
    expect(viewports).toContain(375);
  });

  test("all scenarios have phase-to-criteria mapping", async () => {
    const scenarios = await loadAllScenarios();
    for (const scenario of scenarios) {
      for (const criterion of scenario.acceptance_criteria) {
        expect(criterion.phase_ref).toBeDefined();
        expect(typeof criterion.phase_ref).toBe("number");
      }
    }
  });

  test("all scenarios with counterfactual prompts have reference implementations", async () => {
    const scenarios = await loadAllScenarios();
    for (const scenario of scenarios) {
      if (scenario.counterfactual_prompt) {
        expect(
          scenario.reference_good,
          `${scenario.name} has counterfactual_prompt but no reference_good`,
        ).toBeTruthy();
        expect(
          scenario.reference_bad,
          `${scenario.name} has counterfactual_prompt but no reference_bad`,
        ).toBeTruthy();
      }
    }
  });
});

describe("Reference Calibration - Scenario 05 (Stale Imports)", () => {
  test("known-good passes all content/file checks", async () => {
    const scenario = await loadScenarioByName("05-stale-imports");

    const contentChecks = scenario.acceptance_criteria.filter(
      (c) =>
        c.type === "content_matches" ||
        c.type === "content_not_matches" ||
        c.type === "content_matches_glob" ||
        c.type === "content_not_matches_glob" ||
        c.type === "file_exists",
    );

    const refsDir = join(REFS_DIR, "05-stale-imports", "known-good");
    const { passRate, results } = await runReferenceCheck(contentChecks, refsDir);

    for (const result of results) {
      if (!result.passed) {
        console.log(`  FAIL: ${result.criterion_id} — ${result.message}`);
      }
    }

    expect(passRate).toBe(1);
  });

  test("known-bad fails rename checks", async () => {
    const scenario = await loadScenarioByName("05-stale-imports");

    const contentChecks = scenario.acceptance_criteria.filter(
      (c) =>
        c.type === "content_matches" ||
        c.type === "content_not_matches" ||
        c.type === "content_matches_glob" ||
        c.type === "content_not_matches_glob" ||
        c.type === "file_exists",
    );

    const refsDir = join(REFS_DIR, "05-stale-imports", "known-bad");
    const { passRate } = await runReferenceCheck(contentChecks, refsDir);
    expect(passRate).toBeLessThanOrEqual(0.6);
  });
});

describe("Reference Calibration - Scenario 04 (Build Failures)", () => {
  test("known-good passes all content/file checks", async () => {
    const scenario = await loadScenarioByName("04-build-failures-ignored");

    const contentChecks = scenario.acceptance_criteria.filter(
      (c) =>
        c.type === "content_matches" ||
        c.type === "content_not_matches" ||
        c.type === "file_exists",
    );

    const refsDir = join(REFS_DIR, "04-build-failures-ignored", "known-good");
    const { passRate } = await runReferenceCheck(contentChecks, refsDir);
    expect(passRate).toBe(1);
  });

  test("known-bad fails type/import checks", async () => {
    const scenario = await loadScenarioByName("04-build-failures-ignored");

    const contentChecks = scenario.acceptance_criteria.filter(
      (c) =>
        c.type === "content_matches" ||
        c.type === "content_not_matches" ||
        c.type === "file_exists",
    );

    const refsDir = join(REFS_DIR, "04-build-failures-ignored", "known-bad");
    const { passRate } = await runReferenceCheck(contentChecks, refsDir);
    expect(passRate).toBeLessThanOrEqual(0.6);
  });
});
