import { expect, test } from "@playwright/test";

/**
 * "Your event" and "Your package" at phone width: the last two couple pages
 * brought into the kit in M5 of docs/mobile-first-client-crew-plan-2026-09-28.md.
 * Mock mode (see the other mobile-client specs for the build command).
 */

test.use({ serviceWorkers: "block" });

test("your event is one list of the confirmed details", async ({ page }) => {
  await page.goto("/client/project");
  const details = page.getByRole("list", { name: "Event details" });
  await expect(details.getByText("Venue")).toBeVisible();
  await expect(details.getByText("Lead photographer")).toBeVisible();
  await expect(page.getByRole("link", { name: "Send a message" })).toHaveAttribute("href", /context=Event%20details/);
});

test("a package is chosen with its add-ons, confirmed in a sheet, then locked", async ({ page }) => {
  await page.goto("/client/package");
  await page.getByRole("button", { name: /Signature/ }).click();
  await expect(page.locator(".kit-total-bar strong")).toHaveText("$6,500.00");
  // Coverage is roles, read from the package's real field.
  const signature = page.locator("article").filter({ hasText: "Signature" });
  await expect(signature.getByText("2 photographers")).toBeVisible();
  await expect(signature.getByText("1 videographer")).toBeVisible();
  await page.getByRole("checkbox", { name: /Heirloom album/ }).check();
  await expect(page.locator(".kit-total-bar strong")).toHaveText("$7,700.00");
  await page.getByRole("button", { name: "Choose Signature" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(/with Heirloom album/)).toBeVisible();
  await sheet.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Signature" })).toBeVisible();
  await expect(page.getByText(/Your price is locked/)).toBeVisible();
  await expect(page.getByText("Heirloom album")).toBeVisible();
});
