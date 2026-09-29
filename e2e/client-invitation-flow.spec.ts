import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const token = "a".repeat(43);
const invitationPath = `/auth/client-invite?token=${token}`;

/**
 * The invitation a couple opens from their studio's email: the studio's
 * welcome, then the invited address and a password, on one phone screen
 * (M2 of docs/mobile-first-client-crew-plan-2026-09-28.md). In mock mode the
 * preview is the demo studio's.
 */
test("a client invitation is the studio's welcome, on one phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(invitationPath);

  await expect(page.getByText("A private invitation from Aperture & Light Studio")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome to Your photography project" })).toBeVisible();
  // The address comes from the invitation; it is shown, never typed.
  await expect(page.getByText("Joining as")).toContainText("you@example.com");
  await expect(page.getByLabel("Choose a password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account and accept" })).toBeVisible();
  await expect(page.getByText("Powered by StudioCue")).toBeVisible();
  // StudioCue's own mark no longer heads the page.
  await expect(page.locator(".client-invite-header")).toHaveCount(0);

  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
});

/**
 * Was: "invitation context survives sign in, registration, and recovery",
 * which followed a "Sign in to continue" link to the generic auth pages. That
 * link went when invitations took the password inline (invitation-join.tsx),
 * so the test could no longer pass; e2e had not run on this machine to show it.
 */
test("a new client sets a password of at least 12 characters, in place", async ({ page }) => {
  await page.goto(invitationPath);
  const password = page.getByLabel("Choose a password");
  await expect(password).toHaveAttribute("minlength", "12");
  await expect(password).toHaveAttribute("autocomplete", "new-password");
  await expect(page.getByText("At least 12 characters.")).toBeVisible();
});
