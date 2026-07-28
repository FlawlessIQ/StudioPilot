import { expect, test } from "@playwright/test";

test("forgot-password request uses the branded recovery flow", async ({
  page,
}) => {
  await page.goto("/auth/forgot-password");
  await expect(
    page.getByRole("heading", { name: "Reset your password" }),
  ).toBeVisible();
  await page.getByLabel("Account email").fill("client@example.test");
  await page.getByRole("button", { name: "Email reset link" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your inbox" }),
  ).toBeVisible();
  await expect(page.getByText(/branded reset request/i)).toBeVisible();
});

test("password-reset completion has validation and a clear destination", async ({
  page,
}) => {
  await page.goto("/auth/reset-password?oobCode=preview-code");
  await expect(
    page.getByRole("heading", { name: "Choose a new password" }),
  ).toBeVisible();
  await page
    .getByLabel("New password", { exact: true })
    .fill("a-secure-preview-password");
  await page
    .getByLabel("Confirm new password")
    .fill("a-secure-preview-password");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(
    page.getByRole("heading", { name: "Password updated" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in to StudioCue" }),
  ).toHaveAttribute("href", "/auth/login");
});

test("email verification action returns users to sign in", async ({ page }) => {
  await page.goto("/auth/verify-email?oobCode=preview-code");
  await expect(
    page.getByRole("heading", { name: "Email verified" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Continue to sign in" }),
  ).toHaveAttribute("href", "/auth/login?verified=1");
});
