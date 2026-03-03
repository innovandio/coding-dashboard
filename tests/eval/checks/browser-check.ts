import type { AcceptanceCriterion, CheckContext, CheckHandler, CheckResult } from "../lib/types";

interface VisibilityAssertion {
  selector?: string;
  text?: string;
  visible?: boolean;
}

/**
 * Navigates to a URL and asserts element visibility.
 *
 * Expects the context.browser to be a Playwright Browser instance.
 * If no browser is available, the check is skipped with a message.
 */
export const browserVisibleCheck: CheckHandler = {
  type: "browser_visible",

  async run(criterion: AcceptanceCriterion, context: CheckContext): Promise<CheckResult> {
    const start = performance.now();
    const urlPath = criterion.url as string;
    const assertions = criterion.assertions as VisibilityAssertion[] | undefined;
    const viewport = criterion.viewport as { width: number; height: number } | undefined;

    if (!context.browser || !context.baseUrl) {
      return {
        criterion_id: criterion.id,
        phase_ref: criterion.phase_ref,
        passed: false,
        message: "No browser or baseUrl configured — cannot run browser check",
        duration_ms: performance.now() - start,
        attempt: 1,
      };
    }

    const browser = context.browser as import("@playwright/test").Browser;
    const page = await browser.newPage();

    try {
      if (viewport) {
        await page.setViewportSize(viewport);
      }

      await page.goto(`${context.baseUrl}${urlPath}`, {
        waitUntil: "networkidle",
        timeout: 15_000,
      });

      const failures: string[] = [];

      if (assertions) {
        for (const assertion of assertions) {
          const shouldBeVisible = assertion.visible !== false;
          let locator;

          if (assertion.selector) {
            locator = page.locator(assertion.selector);
          } else if (assertion.text) {
            locator = page.getByText(assertion.text);
          } else {
            continue;
          }

          const isVisible = await locator
            .first()
            .isVisible({ timeout: 5_000 })
            .catch(() => false);

          if (shouldBeVisible && !isVisible) {
            failures.push(`Expected visible: ${assertion.selector ?? `text="${assertion.text}"`}`);
          } else if (!shouldBeVisible && isVisible) {
            failures.push(`Expected hidden: ${assertion.selector ?? `text="${assertion.text}"`}`);
          }
        }
      }

      const passed = failures.length === 0;
      return {
        criterion_id: criterion.id,
        phase_ref: criterion.phase_ref,
        passed,
        message: passed
          ? `Browser check passed: ${urlPath}`
          : `Browser check failed: ${failures.join("; ")}`,
        duration_ms: performance.now() - start,
        attempt: 1,
        details: passed ? undefined : { failures },
      };
    } catch (err) {
      return {
        criterion_id: criterion.id,
        phase_ref: criterion.phase_ref,
        passed: false,
        message: `Browser check error: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: performance.now() - start,
        attempt: 1,
      };
    } finally {
      await page.close();
    }
  },
};
