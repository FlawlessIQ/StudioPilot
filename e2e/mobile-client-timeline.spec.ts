import { expect, test } from "@playwright/test";

/**
 * The couple's wedding-day timeline at phone width (M4 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md), against the mock
 * schedule in components/client/live-client-views.tsx. Build in mock mode:
 *
 *   NEXT_PUBLIC_DATA_MODE=mock NEXT_PUBLIC_AUTH_MODE=mock \
 *   NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true NEXT_PUBLIC_CRM_FUNCTIONS_URL= npm run build
 */

// The phone is in Los Angeles; the wedding is in New York. Every time on the
// page, and in the change request, is the wedding's.
test.use({ serviceWorkers: "block", timezoneId: "America/Los_Angeles" });

test("the timeline reads in the wedding's zone and shows only the couple's moments", async ({ page }) => {
  await page.goto("/client/schedule");
  const timeline = page.getByRole("list", { name: "Timeline" });
  await expect(page.getByText(/Times are in Eastern Time/)).toBeVisible();
  await expect(timeline.getByText("Ceremony", { exact: true })).toBeVisible();
  await expect(timeline.locator("li").filter({ hasText: "Ceremony" }).first()).toContainText("5:00 PM");
  // Crew-only, and an item with no time, are not the couple's to see.
  await expect(timeline.getByText("Crew meal break")).toHaveCount(0);
  await expect(timeline.getByText("Sparkler exit")).toHaveCount(0);
  await expect(page.locator("select")).toHaveCount(0);
});

test("a change request starts from the moment it is about", async ({ page }) => {
  await page.goto("/client/schedule");
  await page.getByRole("button", { name: "Ask about Ceremony" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("About Ceremony at 5:00 PM.")).toBeVisible();
  const send = sheet.getByRole("button", { name: "Send to your studio" });
  await expect(send).toBeDisabled();
  await sheet.getByRole("textbox", { name: /What should change/ }).fill("Could we start at 5:30 instead?");
  await send.click();
  await expect(page.getByText(/You asked for changes to version 3/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve timeline" })).toHaveCount(0);
});

test("approving asks once more, then says what was approved", async ({ page }) => {
  await page.goto("/client/schedule");
  await page.getByRole("button", { name: "Approve timeline" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Not yet" }).click();
  await expect(sheet).toHaveCount(0);
  await page.getByRole("button", { name: "Approve timeline" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve version 3" }).click();
  await expect(page.getByText(/You approved version 3/)).toBeVisible();
});
