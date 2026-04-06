import { mkdtemp, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test } from "vitest";
import { contentNotMatchesCheck, contentNotMatchesGlobCheck } from "./checks/content-matches";
import { loadScenario } from "./lib/scenario-loader";
import type { AcceptanceCriterion } from "./lib/types";

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe("Scenario validation", () => {
  test("rejects vacuous http_request expectations", async () => {
    const dir = await createTempDir("eval-scenario-");
    const file = join(dir, "invalid.yaml");

    await writeFile(
      file,
      `
name: "Invalid"
description: "Invalid scenario"
difficulty: easy
fixture: nextjs-minimal
gsd_tasks:
  - phase: 1
    title: "One phase"
    plans: ["do thing"]
acceptance_criteria:
  - id: bad-http
    phase_ref: 1
    type: http_request
    url: "/api/thing"
    expect: {}
`,
      "utf-8",
    );

    await expect(loadScenario(file)).rejects.toThrow(
      "expect must include at least one assertion key",
    );
  });

  test("rejects browser_interaction with empty steps", async () => {
    const dir = await createTempDir("eval-scenario-");
    const file = join(dir, "invalid-browser.yaml");

    await writeFile(
      file,
      `
name: "Invalid Browser"
description: "Invalid scenario"
difficulty: easy
fixture: nextjs-minimal
gsd_tasks:
  - phase: 1
    title: "One phase"
    plans: ["do thing"]
acceptance_criteria:
  - id: bad-browser
    phase_ref: 1
    type: browser_interaction
    url: "/dashboard"
    steps: []
`,
      "utf-8",
    );

    await expect(loadScenario(file)).rejects.toThrow("requires non-empty array field 'steps'");
  });
});

describe("Content checks", () => {
  test("content_not_matches fails when target file is missing", async () => {
    const workspacePath = await createTempDir("eval-content-");
    const criterion = {
      id: "no-missing-pass",
      phase_ref: 1,
      type: "content_not_matches",
      path: "src/missing.ts",
      pattern: "should-not-matter",
    } as AcceptanceCriterion;

    const result = await contentNotMatchesCheck.run(criterion, { workspacePath });
    expect(result.passed).toBe(false);
    expect(result.message).toContain("Failed to read");
  });

  test("content_not_matches_glob finds stale imports across files", async () => {
    const workspacePath = await createTempDir("eval-glob-");
    await mkdir(join(workspacePath, "src"), { recursive: true });

    await writeFile(
      join(workspacePath, "src", "a.ts"),
      `import { formatDate } from "@/lib/date-utils";`,
      "utf-8",
    );
    await writeFile(
      join(workspacePath, "src", "b.ts"),
      `import { formatDateTime } from "@/lib/date-utils";`,
      "utf-8",
    );

    const staleCriterion = {
      id: "stale-import-check",
      phase_ref: 1,
      type: "content_not_matches_glob",
      glob: "src/**/*.ts",
      pattern: "formatDate\\b",
      flags: "m",
    } as AcceptanceCriterion;

    const staleResult = await contentNotMatchesGlobCheck.run(staleCriterion, {
      workspacePath,
    });
    expect(staleResult.passed).toBe(false);

    const cleanCriterion = {
      ...staleCriterion,
      id: "clean-import-check",
      pattern: "formatCurrency\\b",
    } as AcceptanceCriterion;
    const cleanResult = await contentNotMatchesGlobCheck.run(cleanCriterion, {
      workspacePath,
    });
    expect(cleanResult.passed).toBe(true);
  });
});
