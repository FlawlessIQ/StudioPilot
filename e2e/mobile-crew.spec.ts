import { expect, test } from "@playwright/test";

/**
 * The crew workspace at phone width (M6 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md), against the mock crew in
 * features/crew/mock-crew.ts: an open offer, a job in six days whose run of
 * show changed since it was read, and a past job whose hours are owed. Build
 * in mock mode:
 *
 *   NEXT_PUBLIC_DATA_MODE=mock NEXT_PUBLIC_AUTH_MODE=mock \
 *   NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true NEXT_PUBLIC_CRM_FUNCTIONS_URL= npm run build
 */

// The phone is in Los Angeles; the wedding is in New York.
test.use({ serviceWorkers: "block", timezoneId: "America/Los_Angeles" });

test("today leads with the next job and names only what needs you", async ({ page }) => {
  await page.goto("/crew");
  const hero = page.locator(".kit-card[data-tone='accent']").first();
  await expect(hero).toContainText("Next up · in 6 days");
  await expect(hero).toContainText("Rivera wedding");
  await expect(hero).toContainText("call 1:00 PM");
  const needs = page.getByRole("region", { name: "Needs you" });
  await expect(needs.getByText("New offer: Nguyen & Park wedding")).toBeVisible();
  await expect(needs.getByText("Run of show for Rivera wedding")).toBeVisible();
  await expect(needs.getByText("Send in your hours: Lopez wedding")).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs.getByRole("link")).toHaveText(["Today", "Jobs", "Calendar", "Me"]);
});

test("jobs are compact rows; an offer is answered on its own screen, and decline asks why", async ({ page }) => {
  await page.goto("/crew/jobs");
  await expect(page.getByRole("region", { name: "Offers" }).locator(".kit-row")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Coming up" }).locator(".kit-row")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Finished" }).locator(".kit-row")).toHaveCount(1);
  await page.getByRole("link", { name: /Nguyen & Park wedding/ }).click();
  await expect(page).toHaveURL(/\/crew\/pending\?assignment=demo-offer/);
  await expect(page.getByText("$850.00")).toBeVisible();
  await expect(page.getByText(/days left/)).toBeVisible();

  await page.locator(".kit-actions").getByRole("button", { name: "Decline" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "I'm not free" }).click();
  await sheet.getByRole("button", { name: "Keep it open" }).click();
  await expect(sheet).toHaveCount(0);
  await page.locator(".kit-actions").getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText(/You’re booked/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to my calendar" })).toBeVisible();
});

test("the job is one screen: day sheet, checklist with a camera, and the run of show can't be ticked here", async ({ page }) => {
  await page.goto("/crew/requirements?assignment=demo-upcoming");
  await expect(page).toHaveURL(/\/crew\/prep\?assignment=demo-upcoming#checklist/);
  const checklist = page.getByRole("region", { name: "Checklist" });
  const w9 = checklist.locator("li").filter({ hasText: "W-9" });
  await expect(w9.getByText("Take a photo")).toBeVisible();
  await expect(w9.locator("input[capture='environment']")).toHaveCount(1);
  // The run of show is confirmed against a version, on the day sheet.
  await expect(checklist.locator("li").filter({ hasText: "Read the run of show" }).getByRole("link", { name: "Read and confirm" })).toBeVisible();
  await checklist.getByRole("button", { name: "I'll bring it" }).click();
  await expect(checklist.getByText("Done")).toBeVisible();
});

test("the day sheet reads in the wedding's zone, with who not to photograph and the formals", async ({ page }) => {
  await page.goto("/crew/schedule?assignment=demo-upcoming");
  await expect(page.getByText(/Times in Eastern Time/)).toBeVisible();
  const order = page.getByRole("list", { name: "Running order" });
  await expect(order.locator("li").filter({ hasText: "Ceremony" })).toContainText("5:00 PM");
  await expect(page.getByText("Read before you shoot")).toBeVisible();
  await expect(page.getByText(/uncle Mark/)).toBeVisible();
  await expect(page.getByText("Family formals").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Go" })).toHaveAttribute("href", /google\.com\/maps/);
  await expect(page.getByRole("link", { name: "Call" })).toHaveAttribute("href", /^tel:/);
  await page.locator(".kit-actions").getByRole("button", { name: "I've read version 2" }).click();
  await expect(page.locator(".kit-actions")).toContainText("You've read version 2");
});

test("hours are prefilled, extra time steps, expenses are a list you add to", async ({ page }) => {
  await page.goto("/crew/closeout");
  await expect(page.getByRole("heading", { level: 1, name: "Lopez wedding" })).toBeVisible();
  await expect(page.getByLabel("Started")).not.toHaveValue("");
  await page.getByRole("button", { name: "15 minutes more" }).click();
  await page.getByRole("button", { name: "15 minutes more" }).click();
  await expect(page.locator(".kit-stepper-control output")).toHaveText("0 h 30 min");
  await page.getByRole("button", { name: "Add an expense" }).click();
  await page.getByLabel("What for").fill("Parking");
  await page.getByLabel("Amount ($)").fill("18.50");
  await page.locator(".kit-actions").getByRole("button", { name: "Send to the studio" }).click();
  await expect(page.getByText(/Received\. Your studio reviews it/)).toBeVisible();
});

test("the calendar marks a day away, and a removal can be undone", async ({ page }) => {
  await page.goto("/crew/availability");
  const days = page.locator(".kit-month-day:not([disabled])");
  const pick = days.filter({ hasNot: page.locator("[data-state]") }).last();
  await pick.click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "I'm away" }).click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toHaveCount(0);

  await page.getByRole("region", { name: "Your dates" }).getByRole("button", { name: /Family trip/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove these dates" }).click();
  await expect(page.getByText(/^Removed /)).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("region", { name: "Your dates" }).getByText("Family trip")).toBeVisible();
});

test("me: what you shoot and your gear are chips, saved together", async ({ page }) => {
  await page.goto("/crew/account");
  await expect(page.getByRole("heading", { level: 1, name: "Sam Carter" })).toBeVisible();
  await page.getByRole("button", { name: "Videographer" }).click();
  await page.getByLabel("Your gear").fill("Sony FX3");
  await page.getByLabel("Your gear").press("Enter");
  await expect(page.getByRole("button", { name: "Remove Sony FX3" })).toBeVisible();
  await page.locator(".kit-actions").getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});
