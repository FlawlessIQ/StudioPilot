import { expect, test } from "@playwright/test";

/**
 * After the wedding at phone width (M5 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md): photos and film, the
 * album, and the review ask, against the mock records in
 * components/client/live-client-views.tsx. Build in mock mode:
 *
 *   NEXT_PUBLIC_DATA_MODE=mock NEXT_PUBLIC_AUTH_MODE=mock \
 *   NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true NEXT_PUBLIC_CRM_FUNCTIONS_URL= npm run build
 */

test.use({ serviceWorkers: "block" });

test("photos and film are separate deliveries, each saying what it opens", async ({ page }) => {
  await page.goto("/client/delivery");
  await expect(page.getByRole("heading", { level: 1, name: "Your photos and film" })).toBeVisible();

  // Newest first: the film, then the gallery, then the sneak peek.
  const titles = page.locator("article .kit-section");
  await expect(titles).toHaveText(["Highlight film", "Your gallery", "Sneak peek"]);

  // A Vimeo link is a film with a password, whatever the studio's form said.
  const film = page.locator("article").filter({ hasText: "Highlight film" });
  await expect(film.getByText("Password")).toBeVisible();
  await expect(film.getByRole("link", { name: /Watch your film/ })).toHaveAttribute("href", "https://vimeo.com/123456789");
  await expect(film.getByRole("button", { name: /downloaded everything/ })).toHaveCount(0);

  const gallery = page.locator("article").filter({ hasText: "Your gallery" });
  await expect(gallery.getByRole("link", { name: /Open your gallery/ })).toHaveAttribute("target", "_blank");
  await gallery.getByRole("button", { name: "I’ve downloaded everything" }).click();
  await expect(gallery.getByText("You’ve saved these")).toBeVisible();
});

test("the album design is approved in a sheet, once", async ({ page }) => {
  await page.goto("/client/delivery");
  const album = page.getByRole("region", { name: "Your album" });
  await expect(album.locator("[data-state='current']")).toContainText("Review the design");
  await album.getByRole("button", { name: "Approve design" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Not yet" }).click();
  await expect(sheet).toHaveCount(0);
  await album.getByRole("button", { name: "Approve design" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve design" }).click();
  await expect(album.locator("[data-state='current']")).toContainText("Design approved");
  await expect(album.getByRole("button", { name: "Approve design" })).toHaveCount(0);
});

test("the review ask is one button, and saying it's done stops it", async ({ page }) => {
  await page.goto("/client/reviews");
  await expect(page.getByRole("link", { name: /Leave a review on Google/ })).toHaveAttribute("target", "_blank");
  await expect(page.getByText(/engagement only/)).toHaveCount(0);
  await page.getByRole("button", { name: "I’ve left my review" }).click();
  await expect(page.getByText(/you won’t be asked again/)).toBeVisible();
});
