import { readFile, readdir } from "fs/promises";
import { join, dirname, extname, basename } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import type { Scenario, AcceptanceCriterion, GsdPhaseSpec } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = join(__dirname, "..", "scenarios");
const VALID_CHECK_TYPES = new Set([
  "file_exists",
  "file_not_exists",
  "content_matches",
  "content_not_matches",
  "content_matches_glob",
  "content_not_matches_glob",
  "build_succeeds",
  "lint_passes",
  "type_check_passes",
  "http_request",
  "browser_visible",
  "browser_interaction",
]);

function assertStringField(
  obj: Record<string, unknown>,
  field: string,
  criterionId: string,
): string {
  const value = obj[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Criterion '${criterionId}' requires string field '${field}'`);
  }
  return value;
}

function assertOptionalStringField(
  obj: Record<string, unknown>,
  field: string,
  criterionId: string,
): void {
  const value = obj[field];
  if (value == null) return;
  if (typeof value !== "string") {
    throw new Error(`Criterion '${criterionId}' has invalid '${field}' (must be a string)`);
  }
}

function assertNonEmptyArrayField(
  obj: Record<string, unknown>,
  field: string,
  criterionId: string,
): unknown[] {
  const value = obj[field];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Criterion '${criterionId}' requires non-empty array field '${field}'`);
  }
  return value;
}

function validateRetry(obj: Record<string, unknown>, criterionId: string): void {
  const retry = obj.retry as Record<string, unknown> | undefined;
  if (!retry) return;

  if (!Number.isInteger(retry.attempts) || (retry.attempts as number) <= 0) {
    throw new Error(`Criterion '${criterionId}' retry.attempts must be a positive integer`);
  }

  if (!Number.isInteger(retry.delay_ms) || (retry.delay_ms as number) < 0) {
    throw new Error(`Criterion '${criterionId}' retry.delay_ms must be a non-negative integer`);
  }
}

function validateHttpExpectation(obj: Record<string, unknown>, criterionId: string): void {
  const expect = obj.expect as Record<string, unknown> | undefined;
  if (!expect || typeof expect !== "object" || Array.isArray(expect)) {
    throw new Error(`Criterion '${criterionId}' requires object field 'expect'`);
  }

  const hasAssertion =
    expect.status != null ||
    expect.headers != null ||
    (Array.isArray(expect.body_contains) && expect.body_contains.length > 0) ||
    (Array.isArray(expect.body_not_contains) && expect.body_not_contains.length > 0) ||
    (Array.isArray(expect.body_json_has_keys) && expect.body_json_has_keys.length > 0);

  if (!hasAssertion) {
    throw new Error(`Criterion '${criterionId}' expect must include at least one assertion key`);
  }
}

function validateTypeSpecificFields(obj: Record<string, unknown>, criterionId: string): void {
  switch (obj.type) {
    case "file_exists":
    case "file_not_exists":
      assertStringField(obj, "path", criterionId);
      break;

    case "content_matches":
    case "content_not_matches":
      assertStringField(obj, "path", criterionId);
      assertStringField(obj, "pattern", criterionId);
      assertOptionalStringField(obj, "flags", criterionId);
      break;

    case "content_matches_glob":
    case "content_not_matches_glob": {
      const glob = obj.glob;
      if (
        (typeof glob !== "string" || glob.trim().length === 0) &&
        !(
          Array.isArray(glob) &&
          glob.length > 0 &&
          glob.every((entry) => typeof entry === "string" && entry.trim().length > 0)
        )
      ) {
        throw new Error(
          `Criterion '${criterionId}' requires 'glob' (non-empty string or non-empty string[])`,
        );
      }
      assertStringField(obj, "pattern", criterionId);
      assertOptionalStringField(obj, "flags", criterionId);
      break;
    }

    case "build_succeeds":
    case "lint_passes":
    case "type_check_passes":
      assertOptionalStringField(obj, "command", criterionId);
      break;

    case "http_request":
      assertStringField(obj, "url", criterionId);
      validateHttpExpectation(obj, criterionId);
      break;

    case "browser_visible":
      assertStringField(obj, "url", criterionId);
      assertNonEmptyArrayField(obj, "assertions", criterionId);
      break;

    case "browser_interaction":
      assertStringField(obj, "url", criterionId);
      assertNonEmptyArrayField(obj, "steps", criterionId);
      break;
  }
}

function validateCriterion(c: unknown, index: number): AcceptanceCriterion {
  const obj = c as Record<string, unknown>;
  if (!obj.id || typeof obj.id !== "string") {
    throw new Error(`Criterion #${index} missing required 'id' field`);
  }
  if (!obj.type || typeof obj.type !== "string") {
    throw new Error(`Criterion '${obj.id}' missing required 'type' field`);
  }
  if (!VALID_CHECK_TYPES.has(obj.type)) {
    throw new Error(`Criterion '${obj.id}' has unsupported type '${obj.type}'.`);
  }
  if (obj.phase_ref == null || typeof obj.phase_ref !== "number") {
    throw new Error(`Criterion '${obj.id}' missing required 'phase_ref' field`);
  }
  validateRetry(obj, obj.id);
  validateTypeSpecificFields(obj, obj.id);
  return obj as unknown as AcceptanceCriterion;
}

function validatePhase(p: unknown, index: number): GsdPhaseSpec {
  const obj = p as Record<string, unknown>;
  if (obj.phase == null || typeof obj.phase !== "number") {
    throw new Error(`GSD task #${index} missing required 'phase' number`);
  }
  if (!obj.title || typeof obj.title !== "string") {
    throw new Error(`GSD task #${index} missing required 'title'`);
  }
  if (!Array.isArray(obj.plans)) {
    throw new Error(`GSD task #${index} missing required 'plans' array`);
  }
  return obj as unknown as GsdPhaseSpec;
}

function validateScenario(raw: unknown, filePath: string): Scenario {
  const obj = raw as Record<string, unknown>;
  const requiredStrings = ["name", "description", "difficulty", "fixture"];
  for (const field of requiredStrings) {
    if (!obj[field] || typeof obj[field] !== "string") {
      throw new Error(`Scenario '${filePath}' missing required field '${field}'`);
    }
  }

  const difficulty = obj.difficulty as string;
  if (!["easy", "medium", "hard"].includes(difficulty)) {
    throw new Error(`Scenario '${filePath}' has invalid difficulty '${difficulty}'`);
  }

  if (!Array.isArray(obj.gsd_tasks) || obj.gsd_tasks.length === 0) {
    throw new Error(`Scenario '${filePath}' must have at least one gsd_task`);
  }

  if (!Array.isArray(obj.acceptance_criteria) || obj.acceptance_criteria.length === 0) {
    throw new Error(`Scenario '${filePath}' must have at least one acceptance_criterion`);
  }

  const gsd_tasks = (obj.gsd_tasks as unknown[]).map(validatePhase);
  const acceptance_criteria = (obj.acceptance_criteria as unknown[]).map(validateCriterion);

  const phaseNumbers = new Set(gsd_tasks.map((t) => t.phase));
  const criterionIds = new Set<string>();
  for (const criterion of acceptance_criteria) {
    if (!phaseNumbers.has(criterion.phase_ref)) {
      throw new Error(
        `Criterion '${criterion.id}' references phase ${criterion.phase_ref} ` +
          `which doesn't exist in gsd_tasks`,
      );
    }

    if (criterionIds.has(criterion.id)) {
      throw new Error(`Scenario '${filePath}' has duplicate criterion id '${criterion.id}'`);
    }
    criterionIds.add(criterion.id);
  }

  const id = basename(filePath).replace(/\.(yaml|yml)$/i, "");

  return {
    id,
    name: obj.name as string,
    description: obj.description as string,
    difficulty: difficulty as Scenario["difficulty"],
    tags: Array.isArray(obj.tags) ? (obj.tags as string[]) : [],
    fixture: obj.fixture as string,
    reference_good: obj.reference_good as string | undefined,
    reference_bad: obj.reference_bad as string | undefined,
    counterfactual_prompt: obj.counterfactual_prompt as string | undefined,
    gsd_tasks,
    acceptance_criteria,
  };
}

export async function loadScenario(filePath: string): Promise<Scenario> {
  const content = await readFile(filePath, "utf-8");
  const raw = parseYaml(content);
  return validateScenario(raw, filePath);
}

export async function loadScenarioByName(name: string): Promise<Scenario> {
  const files = await readdir(SCENARIOS_DIR);
  const normalized = name.trim().toLowerCase();
  const match = files.find((f) => {
    const lower = f.toLowerCase();
    return (
      lower.startsWith(normalized) ||
      lower === `${normalized}.yaml` ||
      lower === `${normalized}.yml`
    );
  });

  if (match) {
    return loadScenario(join(SCENARIOS_DIR, match));
  }

  // Fallback: allow lookup by human-readable scenario title.
  const yamlFiles = files.filter((f) => {
    const ext = extname(f);
    return (ext === ".yaml" || ext === ".yml") && !f.startsWith("_");
  });

  for (const file of yamlFiles) {
    const scenario = await loadScenario(join(SCENARIOS_DIR, file));
    if (scenario.name.toLowerCase() === normalized || scenario.id === normalized) {
      return scenario;
    }
  }

  throw new Error(
    `Scenario '${name}' not found in ${SCENARIOS_DIR}. Available: ${yamlFiles.join(", ")}`,
  );
}

export async function loadAllScenarios(): Promise<Scenario[]> {
  const files = await readdir(SCENARIOS_DIR);
  const yamlFiles = files
    .filter((f) => {
      const ext = extname(f);
      return (ext === ".yaml" || ext === ".yml") && !f.startsWith("_");
    })
    .sort();

  return Promise.all(yamlFiles.map((f) => loadScenario(join(SCENARIOS_DIR, f))));
}
