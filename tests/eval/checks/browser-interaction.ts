import type { AcceptanceCriterion, CheckContext, CheckHandler, CheckResult } from "../lib/types";

interface InteractionStep {
  fill?: { selector: string; value: string };
  click?: { selector: string };
  wait?: { ms: number };
  execute_js?: {
    expression: string;
    expect_truthy?: boolean;
    expect_value?: unknown;
  };
  assert_visible?: { selector?: string; text?: string };
  assert_hidden?: { selector?: string; text?: string };
  assert_url?: { pattern: string };
}

/**
 * Navigates to a URL and executes a sequence of interaction steps.
 * Each step can fill inputs, click buttons, wait, or assert visibility.
 */
export const browserInteractionCheck: CheckHandler = {
  type: "browser_interaction",

  async run(criterion: AcceptanceCriterion, context: CheckContext): Promise<CheckResult> {
    const start = performance.now();
    const urlPath = criterion.url as string;
    const steps = criterion.steps as InteractionStep[] | undefined;
    const viewport = criterion.viewport as { width: number; height: number } | undefined;

    if (!context.browser || !context.baseUrl) {
      return {
        criterion_id: criterion.id,
        phase_ref: criterion.phase_ref,
        passed: false,
        message: "No browser or baseUrl configured — cannot run interaction check",
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

      if (steps) {
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];

          if (step.fill) {
            await page
              .locator(step.fill.selector)
              .first()
              .fill(step.fill.value, { timeout: 5_000 });
          }

          if (step.click) {
            await page.locator(step.click.selector).first().click({ timeout: 5_000 });
          }

          if (step.wait) {
            await page.waitForTimeout(step.wait.ms);
          }

          if (step.execute_js) {
            const value = await page.evaluate(step.execute_js.expression);

            if (step.execute_js.expect_truthy === true && !value) {
              failures.push(
                `Step ${i + 1}: JS expression was not truthy (value: ${JSON.stringify(value)})`,
              );
            }

            if (
              Object.prototype.hasOwnProperty.call(step.execute_js, "expect_value") &&
              JSON.stringify(value) !== JSON.stringify(step.execute_js.expect_value)
            ) {
              failures.push(
                `Step ${i + 1}: JS expression value mismatch (expected ${JSON.stringify(step.execute_js.expect_value)}, got ${JSON.stringify(value)})`,
              );
            }
          }

          if (step.assert_visible) {
            const locator = step.assert_visible.selector
              ? page.locator(step.assert_visible.selector)
              : page.getByText(step.assert_visible.text!);
            const isVisible = await locator
              .first()
              .isVisible({ timeout: 5_000 })
              .catch(() => false);
            if (!isVisible) {
              failures.push(
                `Step ${i + 1}: expected visible: ${step.assert_visible.selector ?? `text="${step.assert_visible.text}"`}`,
              );
            }
          }

          if (step.assert_hidden) {
            const locator = step.assert_hidden.selector
              ? page.locator(step.assert_hidden.selector)
              : page.getByText(step.assert_hidden.text!);
            const isVisible = await locator
              .first()
              .isVisible({ timeout: 2_000 })
              .catch(() => false);
            if (isVisible) {
              failures.push(
                `Step ${i + 1}: expected hidden: ${step.assert_hidden.selector ?? `text="${step.assert_hidden.text}"`}`,
              );
            }
          }

          if (step.assert_url) {
            const regex = new RegExp(step.assert_url.pattern);
            if (!regex.test(page.url())) {
              failures.push(
                `Step ${i + 1}: URL '${page.url()}' doesn't match /${step.assert_url.pattern}/`,
              );
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
          ? `Browser interaction passed: ${urlPath} (${steps?.length ?? 0} steps)`
          : `Browser interaction failed: ${failures.join("; ")}`,
        duration_ms: performance.now() - start,
        attempt: 1,
        details: passed ? undefined : { failures },
      };
    } catch (err) {
      return {
        criterion_id: criterion.id,
        phase_ref: criterion.phase_ref,
        passed: false,
        message: `Browser interaction error: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: performance.now() - start,
        attempt: 1,
      };
    } finally {
      await page.close();
    }
  },
};
