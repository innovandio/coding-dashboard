import { test, expect, type Page } from "@playwright/test";

/** Log in via the sign-in page and return to the dashboard. */
async function loginViaUI(page: Page) {
  await page.goto("/sign-in");
  await page.getByPlaceholder("Email").fill("info@innovandio.com");
  await page.getByPlaceholder("Password").fill("E7f8TEzdSHiK");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("/", { timeout: 15_000 });
}

/** Wait for the avatar to appear (session loaded) after reload. */
async function waitForAvatar(page: Page) {
  await page.reload();
  await expect(
    page.getByRole("img", { name: /avatar/i }).or(page.locator("[data-slot='avatar']")),
  ).toBeVisible({ timeout: 15_000 });
}

test.describe("Authentication", () => {
  test("unauthenticated visit to / redirects to /sign-in", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL("**/sign-in**");
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole("heading", { name: "Coding Dashboard" })).toBeVisible();
  });

  test("unauthenticated API request returns 401", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  test("sign-in page renders email/password form and OAuth buttons", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByPlaceholder("Email")).toBeVisible();
    await expect(page.getByPlaceholder("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "GitHub" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Google" })).toBeVisible();
  });

  test("invalid credentials shows error", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByPlaceholder("Email").fill("wrong@example.com");
    await page.getByPlaceholder("Password").fill("wrongpassword");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/sign-in?error=**");
    await expect(page.getByText("Invalid email or password")).toBeVisible();
  });

  test("valid credentials logs in and shows dashboard with avatar", async ({ page }) => {
    await loginViaUI(page);
    await expect(page).toHaveURL("/");

    // Verify session data via API (uses browser cookies)
    const sessionRes = await page.request.get("/api/auth/session");
    const session = await sessionRes.json();
    expect(session.user).toBeDefined();
    expect(session.user.email).toBe("info@innovandio.com");

    // Reload and wait for the avatar to appear
    await waitForAvatar(page);

    // Open the dropdown and verify user info
    await page.locator("[data-slot='avatar']").click();
    await expect(page.getByText("info@innovandio.com")).toBeVisible();
  });

  test("authenticated API request succeeds", async ({ page }) => {
    await loginViaUI(page);
    const res = await page.request.get("/api/health");
    expect(res.status()).not.toBe(401);
  });

  test("sign out via avatar dropdown redirects to sign-in page", async ({ page }) => {
    await loginViaUI(page);
    await waitForAvatar(page);

    // Open avatar dropdown and click sign out
    await page.locator("[data-slot='avatar']").click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();

    // Should end up on sign-in page
    await page.waitForURL("**/sign-in**", { timeout: 10_000 });
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("visiting /sign-in while authenticated redirects to /", async ({ page }) => {
    await loginViaUI(page);

    // Visit sign-in again — should redirect back to /
    await page.goto("/sign-in");
    await page.waitForURL("/", { timeout: 10_000 });
    await expect(page).toHaveURL("/");
  });
});
