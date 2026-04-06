import type { AcceptanceCriterion, CheckContext, CheckHandler, CheckResult } from "../lib/types";

interface HttpExpectation {
  status?: number;
  body_contains?: string[];
  body_not_contains?: string[];
  body_json_has_keys?: string[];
  headers?: Record<string, string>;
}

export const httpRequestCheck: CheckHandler = {
  type: "http_request",

  async run(criterion: AcceptanceCriterion, context: CheckContext): Promise<CheckResult> {
    const start = performance.now();
    const method = ((criterion.method as string) ?? "GET").toUpperCase();
    const urlPath = criterion.url as string;
    const body =
      (criterion.body_json as Record<string, unknown> | undefined) ??
      (criterion.body as Record<string, unknown> | undefined);
    const bodyRaw = criterion.body_raw as string | undefined;
    const requestHeaders = (criterion.headers as Record<string, string> | undefined) ?? {};
    const expect = criterion.expect as HttpExpectation | undefined;

    if (!context.baseUrl) {
      return {
        criterion_id: criterion.id,
        phase_ref: criterion.phase_ref,
        passed: false,
        message: "No baseUrl configured — cannot run HTTP check",
        duration_ms: performance.now() - start,
        attempt: 1,
      };
    }

    const fullUrl = `${context.baseUrl}${urlPath}`;

    try {
      const fetchOpts: RequestInit = {
        method,
        headers: { ...requestHeaders },
      };

      if (method !== "GET" && method !== "HEAD") {
        if (bodyRaw != null) {
          fetchOpts.body = bodyRaw;
          if (!Object.keys(requestHeaders).some((key) => key.toLowerCase() === "content-type")) {
            (fetchOpts.headers as Record<string, string>)["Content-Type"] = "text/plain";
          }
        } else if (body) {
          fetchOpts.body = JSON.stringify(body);
          if (!Object.keys(requestHeaders).some((key) => key.toLowerCase() === "content-type")) {
            (fetchOpts.headers as Record<string, string>)["Content-Type"] = "application/json";
          }
        }
      }

      const response = await fetch(fullUrl, fetchOpts);
      const responseBody = await response.text();
      const failures: string[] = [];

      if (expect?.status != null && response.status !== expect.status) {
        failures.push(`Expected status ${expect.status}, got ${response.status}`);
      }

      if (expect?.body_contains) {
        for (const needle of expect.body_contains) {
          if (!responseBody.includes(needle)) {
            failures.push(`Response body missing: "${needle}"`);
          }
        }
      }

      if (expect?.body_not_contains) {
        for (const needle of expect.body_not_contains) {
          if (responseBody.includes(needle)) {
            failures.push(`Response body should not contain: "${needle}"`);
          }
        }
      }

      if (expect?.headers) {
        for (const [key, expectedValue] of Object.entries(expect.headers)) {
          const actual = response.headers.get(key);
          if (actual !== expectedValue) {
            failures.push(`Header '${key}': expected '${expectedValue}', got '${actual}'`);
          }
        }
      }

      if (expect?.body_json_has_keys) {
        let parsed: unknown;
        try {
          parsed = responseBody.length > 0 ? JSON.parse(responseBody) : {};
        } catch {
          failures.push("Response body is not valid JSON");
          parsed = null;
        }

        if (parsed && typeof parsed === "object") {
          const value = parsed as Record<string, unknown>;
          for (const key of expect.body_json_has_keys) {
            if (!(key in value)) {
              failures.push(`Response JSON missing key: "${key}"`);
            }
          }
        }
      }

      const passed = failures.length === 0;

      return {
        criterion_id: criterion.id,
        phase_ref: criterion.phase_ref,
        passed,
        message: passed
          ? `${method} ${urlPath} -> ${response.status} OK`
          : `${method} ${urlPath} -> ${failures.join("; ")}`,
        duration_ms: performance.now() - start,
        attempt: 1,
        details: passed
          ? undefined
          : {
              status: response.status,
              body: responseBody.slice(0, 1000),
              failures,
            },
      };
    } catch (err) {
      return {
        criterion_id: criterion.id,
        phase_ref: criterion.phase_ref,
        passed: false,
        message: `${method} ${urlPath} -> Request failed: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: performance.now() - start,
        attempt: 1,
        details: { error: String(err) },
      };
    }
  },
};
