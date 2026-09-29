import { expect, test } from "@playwright/test";

test.describe("client portal critical paths", () => {
  test("provider handoffs explain the return and recovery path", async ({ page }) => {
    await page.goto("/client/contract");
    await expect(page.getByText("You’re opening Dropbox Sign")).toBeVisible();
    await expect(page.getByRole("link", { name: /Continue to secure signing/i })).toHaveAttribute(
      "target",
      "_blank",
    );
    await expect(page.getByRole("link", { name: /Ask your studio about this agreement/i })).toBeVisible();

    await page.goto("/client/payments");
    await expect(page.getByText("Secure payment opens in QuickBooks")).toBeVisible();
    // One sticky button, naming what it pays (M3 of the mobile-first plan).
    await expect(page.getByRole("link", { name: /Pay \$1,826\.50 securely/i })).toHaveAttribute(
      "target",
      "_blank",
    );
  });

  test("schedule approval is explicit and version-specific", async ({ page }) => {
    await page.goto("/client/schedule");
    await expect(page.getByText(/version 3/i).first()).toBeVisible();
    // Approving is a second, deliberate step that names the version (M4).
    await page.getByRole("button", { name: "Approve timeline" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve version 3" }).click();
    await expect(page.getByText(/You approved version 3/)).toBeVisible();
  });

  test("messages preserve context and expose secure attachment controls", async ({ page }) => {
    await page.goto("/client/messages?context=Contract%20signing");
    // A chat (M4): no Subject field; the page it came from travels with it.
    await expect(page.getByLabel("Subject")).toHaveCount(0);
    await expect(page.locator(".kit-composer-context")).toContainText("Contract signing");
    await expect(page.getByLabel("Attach a file or photo")).toBeAttached();
    await expect(page.getByText(/· New$/)).toBeVisible();
  });

  test("records consolidate approved artifacts", async ({ page }) => {
    await page.goto("/client/documents");
    await expect(page.getByRole("heading", { name: "Your files" })).toBeVisible();
    await expect(page.getByText("Retainer invoice")).toBeVisible();
    await expect(page.getByText("Your gallery")).toBeVisible();
    await expect(page.getByText("Highlight film")).toBeVisible();
    await expect(page.getByText("Your album")).toBeVisible();
    await expect(page.getByText("Venue certificate of insurance")).toBeVisible();
  });

  test("delivery exposes gallery safeguards and meaningful album revisions", async ({ page }) => {
    await page.goto("/client/delivery");
    await expect(page.getByRole("button", { name: "Copy access code" })).toBeVisible();
    // Asking for album changes is a sheet with a real note (M5).
    await page.getByRole("button", { name: "Ask for changes" }).click();
    const sheet = page.getByRole("dialog");
    const notes = sheet.getByLabel("What would you like changed?");
    await notes.fill("Please replace the final image on spread four with the alternate portrait.");
    await sheet.getByRole("button", { name: "Send to your studio" }).click();
    await expect(page.getByText(/is making your changes/)).toBeVisible();
  });
});
