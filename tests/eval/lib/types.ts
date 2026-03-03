// ---------------------------------------------------------------------------
// Core types for the Completion Verification Eval Framework
// ---------------------------------------------------------------------------

export type Difficulty = "easy" | "medium" | "hard";

export type CheckType =
  | "file_exists"
  | "file_not_exists"
  | "content_matches"
  | "content_not_matches"
  | "content_matches_glob"
  | "content_not_matches_glob"
  | "build_succeeds"
  | "lint_passes"
  | "type_check_passes"
  | "http_request"
  | "browser_visible"
  | "browser_interaction";

export interface RetryConfig {
  attempts: number;
  delay_ms: number;
}

// ---------------------------------------------------------------------------
// Scenario definition (parsed from YAML)
// ---------------------------------------------------------------------------

export interface GsdPlanSpec {
  title: string;
}

export interface GsdPhaseSpec {
  phase: number;
  title: string;
  plans: string[];
}

export interface AcceptanceCriterion {
  id: string;
  type: CheckType;
  phase_ref: number;
  retry?: RetryConfig;
  [key: string]: unknown;
}

export interface Scenario {
  /** File-stem identifier, e.g. "01-missing-error-handling" */
  id: string;
  name: string;
  description: string;
  difficulty: Difficulty;
  tags: string[];
  fixture: string;
  reference_good?: string;
  reference_bad?: string;
  counterfactual_prompt?: string;
  gsd_tasks: GsdPhaseSpec[];
  acceptance_criteria: AcceptanceCriterion[];
}

// ---------------------------------------------------------------------------
// Claim-time snapshot (captured when a GSD phase transitions to done)
// ---------------------------------------------------------------------------

export interface ClaimSnapshot {
  phase: number;
  claimed_at: string;
  git_sha: string;
  files_changed: string[];
  gsd_file_contents: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Check execution
// ---------------------------------------------------------------------------

export interface CheckContext {
  workspacePath: string;
  baseUrl?: string;
  /** Playwright browser instance — only available for browser_* checks */
  browser?: unknown;
}

export interface CheckResult {
  criterion_id: string;
  phase_ref: number;
  passed: boolean;
  message: string;
  duration_ms: number;
  attempt: number;
  details?: unknown;
}

export interface CheckHandler {
  type: CheckType;
  run(criterion: AcceptanceCriterion, context: CheckContext): Promise<CheckResult>;
}

// ---------------------------------------------------------------------------
// Counterfactual rerun
// ---------------------------------------------------------------------------

export type CounterfactualDiagnosis = "early_stopping" | "capability_gap" | "partial_recovery";

export interface CounterfactualResult {
  phase: number;
  prompt_sent: string;
  results_before: CheckResult[];
  results_after: CheckResult[];
  recovered: boolean;
  diagnosis: CounterfactualDiagnosis;
}

// ---------------------------------------------------------------------------
// Per-phase verdict
// ---------------------------------------------------------------------------

export type PhaseVerdictKind = "legitimate" | "false_completion" | "not_claimed";

export interface PhaseVerdict {
  phase: number;
  claimed_done: boolean;
  snapshot: ClaimSnapshot | null;
  criteria_total: number;
  criteria_passed: number;
  criteria_failed: string[];
  verdict: PhaseVerdictKind;
  counterfactual?: CounterfactualResult;
}

// ---------------------------------------------------------------------------
// Aggregate metrics
// ---------------------------------------------------------------------------

export interface EvalMetrics {
  /** Phases claimed done with failing criteria / total phases claimed done */
  false_completion_rate: number;
  /** ms from scaffold to final phase marked done */
  time_to_done: number;
  /** ms from scaffold to first moment all criteria pass */
  time_to_first_all_green: number;
  /** Counterfactual reruns that recovered / total counterfactual reruns */
  recovery_after_prompt_rate: number;
}

export interface ReferenceCalibration {
  known_good_score: number;
  known_bad_score: number;
}

// ---------------------------------------------------------------------------
// Final eval report
// ---------------------------------------------------------------------------

export interface EvalReport {
  scenario: string;
  timestamp: string;
  phases: PhaseVerdict[];
  metrics: EvalMetrics;
  reference_calibration?: ReferenceCalibration;
}

// ---------------------------------------------------------------------------
// CLI options
// ---------------------------------------------------------------------------

export interface EvalOptions {
  scenario?: string;
  workspace?: string;
  watch?: boolean;
  counterfactual?: boolean;
  counterfactualCmd?: string;
  counterfactualTimeoutMs?: number;
  referenceCheck?: boolean;
  fullReferenceCheck?: boolean;
  all?: boolean;
}
