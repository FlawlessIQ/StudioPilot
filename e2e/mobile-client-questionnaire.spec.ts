import { expect, test } from "@playwright/test";

/**
 * The couple's questionnaire at phone width, one section per screen (M4 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md), against the mock record
 * in components/client/live-client-views.tsx. Build in mock mode:
 *
 *   NEXT_PUBLIC_DATA_MODE=mock NEXT_PUBLIC_AUTH_MODE=mock \
 *   NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true NEXT_PUBLIC_CRM_FUNCTIONS_URL= npm run build
 */

test.use({ serviceWorkers: "block" });

test("a couple answers section by section, sees what is still needed, and sends", async ({ page }) => {
  await page.goto("/client/questionnaire");
  const actions = page.locator(".kit-actions");

  await expect(page.getByRole("heading", { level: 1, name: "The day" })).toBeVisible();
  await expect(page.getByText("Section 1 of 4")).toBeVisible();
  // A choice is a chip, not a <select>.
  await expect(page.locator("select")).toHaveCount(0);
  await page.getByRole("button", { name: "Civil" }).click();
  await expect(page.getByRole("button", { name: "Civil" })).toHaveAttribute("aria-pressed", "true");
  await actions.getByRole("button", { name: /Next section/ }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Family photos" })).toBeVisible();
  const list = page.getByRole("textbox", { name: /Family photo list/ });
  await list.fill("Both sets of parents");
  // The autosave must never take the field (and the phone's keyboard) away.
  await page.waitForTimeout(1_600);
  await expect(list).toBeFocused();
  await expect(list).toBeEnabled();
  await list.pressSequentially("; grandparents");
  await expect(list).toHaveValue("Both sets of parents; grandparents");

  // A conditional question appears only when its condition holds.
  await expect(page.getByText("Their name and phone")).toHaveCount(0);
  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByText("Their name and phone")).toBeVisible();
  await actions.getByRole("button", { name: /Next section/ }).click();

  // The studio's internal-only question is never shown.
  await expect(page.getByRole("heading", { level: 1, name: "Your people" })).toBeVisible();
  await expect(page.getByText("Studio notes")).toHaveCount(0);
  await actions.getByRole("button", { name: /Next section/ }).click();
  await actions.getByRole("button", { name: /Review answers/ }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Nearly there" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Send answers" })).toBeDisabled();
  await page.getByRole("button", { name: /venue photography rules/ }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Anything else" })).toBeVisible();
  await page.getByRole("checkbox").check();
  await actions.getByRole("button", { name: /Review answers/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ready to send" })).toBeVisible();
  await actions.getByRole("button", { name: "Send answers" }).click();

  // Sent: a read-only copy of what the studio has, and nothing left to edit.
  await expect(page.getByRole("heading", { level: 1, name: /^Sent to / })).toBeVisible();
  await expect(page.locator(".kit-main input, .kit-main textarea")).toHaveCount(0);
  await expect(page.getByText("4:30 PM")).toBeVisible();
  await expect(page.getByText("Both sets of parents; grandparents")).toBeVisible();
  await expect(page.getByText("Studio notes")).toHaveCount(0);
});
