import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const token = "a".repeat(43);
const invitationPath = `/auth/client-invite?token=${token}`;

test("client invitation is a branded, project-specific entry point", async ({
  page,
}) => {
  await page.goto(invitationPath);

  await expect(
    page.getByRole("heading", {
      name: "Everything for your project, in one calm place.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Secure client access")).toBeVisible();
  await expect(page.getByText("No subscription or studio setup is required.")).toBeVisible();

  const layout = page.locator(".client-invite-layout");
  const box = await layout.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x ?? 0).toBeGreaterThanOrEqual(18);
  expect((box?.width ?? 0) + (box?.x ?? 0)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
});

test("invitation context survives sign in, registration, and recovery", async ({
  page,
}) => {
  await page.goto(invitationPath);
  await page.getByRole("link", { name: "Sign in to continue" }).click();
  await expect(page).toHaveURL(/\/auth\/login\?next=/, { timeout: 15_000 });

  await expect(
    page.getByRole("heading", { name: "Sign in to open your project" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("heading", { name: "Sign in to your studio" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to invitation" }).last()).toHaveAttribute(
    "href",
    invitationPath,
  );

  const forgotPassword = page.getByRole("link", { name: "Forgot password?" });
  await expect(forgotPassword).toHaveAttribute(
    "href",
    `/auth/forgot-password?next=${encodeURIComponent(invitationPath)}`,
  );

  await page.getByRole("link", { name: "Create client access" }).click();
  await expect(
    page.getByRole("heading", { name: "Create your client access" }),
  ).toBeVisible();
  await expect(page.getByLabel("Invited email")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create client access" }),
  ).toBeVisible();
});
