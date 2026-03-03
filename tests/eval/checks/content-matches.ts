import { readdir, readFile } from "fs/promises";
import { join, relative } from "path";
import type { AcceptanceCriterion, CheckContext, CheckHandler, CheckResult } from "../lib/types";

interface ContentCheckErrorDetails {
  kind: "read_error";
  path: string;
  error: string;
}

interface GlobCheckFailureDetails {
  kind: "glob_failure";
  files_checked: string[];
  failed_files: string[];
}

function globToRegExp(glob: string): RegExp {
  const escaped: string[] = ["^"];
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];

    if (ch === "*") {
      const isDouble = glob[i + 1] === "*";
      if (isDouble) {
        if (glob[i + 2] === "/") {
          escaped.push("(?:.*/)?");
          i += 2;
        } else {
          escaped.push(".*");
          i += 1;
        }
      } else {
        escaped.push("[^/]*");
      }
      continue;
    }

    if (ch === "?") {
      escaped.push("[^/]");
      continue;
    }

    if (ch === "{") {
      const end = glob.indexOf("}", i + 1);
      if (end > i) {
        const options = glob
          .slice(i + 1, end)
          .split(",")
          .map((opt) => opt.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&"));
        escaped.push(`(${options.join("|")})`);
        i = end;
        continue;
      }
    }

    escaped.push(ch.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&"));
  }

  escaped.push("$");
  return new RegExp(escaped.join(""));
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

async function walkFiles(rootDir: string, dir = ""): Promise<string[]> {
  const current = join(rootDir, dir);
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relPath = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(rootDir, relPath)));
    } else if (entry.isFile()) {
      files.push(normalizePath(relPath));
    }
  }

  return files;
}

async function readAndMatchContent(
  criterion: AcceptanceCriterion,
  context: CheckContext,
  relativePath: string,
): Promise<CheckResult> {
  const start = performance.now();
  const pattern = criterion.pattern as string;
  const fullPath = join(context.workspacePath, relativePath);

  try {
    const content = await readFile(fullPath, "utf-8");
    const regex = new RegExp(pattern, criterion.flags as string | undefined);
    const matches = regex.test(content);

    return {
      criterion_id: criterion.id,
      phase_ref: criterion.phase_ref,
      passed: matches,
      message: matches
        ? `Pattern /${pattern}/ found in ${relativePath}`
        : `Pattern /${pattern}/ not found in ${relativePath}`,
      duration_ms: performance.now() - start,
      attempt: 1,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      criterion_id: criterion.id,
      phase_ref: criterion.phase_ref,
      passed: false,
      message: `Failed to read ${relativePath}: ${errorMessage}`,
      duration_ms: performance.now() - start,
      attempt: 1,
      details: {
        kind: "read_error",
        path: relativePath,
        error: errorMessage,
      } satisfies ContentCheckErrorDetails,
    };
  }
}

function isReadError(details: unknown): details is ContentCheckErrorDetails {
  if (!details || typeof details !== "object") return false;
  return (details as ContentCheckErrorDetails).kind === "read_error";
}

async function runGlobMatch(
  criterion: AcceptanceCriterion,
  context: CheckContext,
): Promise<CheckResult> {
  const start = performance.now();
  const pattern = criterion.pattern as string;
  const globValue = criterion.glob as string | string[];
  const globPatterns = Array.isArray(globValue) ? globValue : [globValue];
  const matchers = globPatterns.map((glob) => globToRegExp(normalizePath(glob)));

  const allFiles = await walkFiles(context.workspacePath);
  const matchedFiles = allFiles
    .filter((file) => matchers.some((matcher) => matcher.test(file)))
    .sort();

  if (matchedFiles.length === 0) {
    return {
      criterion_id: criterion.id,
      phase_ref: criterion.phase_ref,
      passed: false,
      message: `No files matched glob(s): ${globPatterns.join(", ")}`,
      duration_ms: performance.now() - start,
      attempt: 1,
      details: { globPatterns },
    };
  }

  const regex = new RegExp(pattern, criterion.flags as string | undefined);
  const failedFiles: string[] = [];

  for (const file of matchedFiles) {
    const fullPath = join(context.workspacePath, file);
    try {
      const content = await readFile(fullPath, "utf-8");
      if (!regex.test(content)) failedFiles.push(file);
    } catch (err) {
      const relPath = normalizePath(relative(context.workspacePath, fullPath));
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        criterion_id: criterion.id,
        phase_ref: criterion.phase_ref,
        passed: false,
        message: `Failed to read ${relPath}: ${errorMessage}`,
        duration_ms: performance.now() - start,
        attempt: 1,
        details: {
          kind: "read_error",
          path: relPath,
          error: errorMessage,
        } satisfies ContentCheckErrorDetails,
      };
    }
  }

  const passed = failedFiles.length === 0;
  return {
    criterion_id: criterion.id,
    phase_ref: criterion.phase_ref,
    passed,
    message: passed
      ? `Pattern /${pattern}/ found in all ${matchedFiles.length} matched files`
      : `Pattern /${pattern}/ missing in ${failedFiles.length}/${matchedFiles.length} files`,
    duration_ms: performance.now() - start,
    attempt: 1,
    details: passed
      ? { files_checked: matchedFiles }
      : ({
          kind: "glob_failure",
          files_checked: matchedFiles,
          failed_files: failedFiles,
        } satisfies GlobCheckFailureDetails),
  };
}

export const contentMatchesCheck: CheckHandler = {
  type: "content_matches",

  async run(criterion: AcceptanceCriterion, context: CheckContext): Promise<CheckResult> {
    return readAndMatchContent(criterion, context, criterion.path as string);
  },
};

export const contentNotMatchesCheck: CheckHandler = {
  type: "content_not_matches",

  async run(criterion: AcceptanceCriterion, context: CheckContext): Promise<CheckResult> {
    const result = await contentMatchesCheck.run(criterion, context);
    if (isReadError(result.details)) return result;

    return {
      ...result,
      passed: !result.passed,
      message: result.passed
        ? `Pattern should not match but does in ${criterion.path}`
        : `Pattern correctly absent from ${criterion.path}`,
    };
  },
};

export const contentMatchesGlobCheck: CheckHandler = {
  type: "content_matches_glob",
  async run(criterion: AcceptanceCriterion, context: CheckContext): Promise<CheckResult> {
    return runGlobMatch(criterion, context);
  },
};

export const contentNotMatchesGlobCheck: CheckHandler = {
  type: "content_not_matches_glob",
  async run(criterion: AcceptanceCriterion, context: CheckContext): Promise<CheckResult> {
    const start = performance.now();
    const pattern = criterion.pattern as string;
    const globValue = criterion.glob as string | string[];
    const globPatterns = Array.isArray(globValue) ? globValue : [globValue];
    const matchers = globPatterns.map((glob) => globToRegExp(normalizePath(glob)));
    const regex = new RegExp(pattern, criterion.flags as string | undefined);

    const allFiles = await walkFiles(context.workspacePath);
    const matchedFiles = allFiles
      .filter((file) => matchers.some((matcher) => matcher.test(file)))
      .sort();

    if (matchedFiles.length === 0) {
      return {
        criterion_id: criterion.id,
        phase_ref: criterion.phase_ref,
        passed: false,
        message: `No files matched glob(s): ${globPatterns.join(", ")}`,
        duration_ms: performance.now() - start,
        attempt: 1,
        details: { globPatterns },
      };
    }

    const filesWithMatches: string[] = [];
    for (const file of matchedFiles) {
      const fullPath = join(context.workspacePath, file);
      try {
        const content = await readFile(fullPath, "utf-8");
        if (regex.test(content)) filesWithMatches.push(file);
      } catch (err) {
        const relPath = normalizePath(relative(context.workspacePath, fullPath));
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
          criterion_id: criterion.id,
          phase_ref: criterion.phase_ref,
          passed: false,
          message: `Failed to read ${relPath}: ${errorMessage}`,
          duration_ms: performance.now() - start,
          attempt: 1,
          details: {
            kind: "read_error",
            path: relPath,
            error: errorMessage,
          } satisfies ContentCheckErrorDetails,
        };
      }
    }

    const passed = filesWithMatches.length === 0;
    return {
      criterion_id: criterion.id,
      phase_ref: criterion.phase_ref,
      passed,
      message: passed
        ? `Pattern /${pattern}/ absent from all ${matchedFiles.length} matched files`
        : `Pattern /${pattern}/ found in ${filesWithMatches.length}/${matchedFiles.length} files`,
      duration_ms: performance.now() - start,
      attempt: 1,
      details: passed
        ? { files_checked: matchedFiles }
        : { files_checked: matchedFiles, failed_files: filesWithMatches },
    };
  },
};
