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
    await expect(page.getByRole("link", { name: /Continue to secure payment/i })).toHaveAttribute(
      "target",
      "_blank",
    );
  });

  test("schedule approval is explicit and version-specific", async ({ page }) => {
    await page.goto("/client/schedule");
    await expect(page.getByText(/Version 3/).first()).toBeVisible();
    await page.getByRole("button", { name: "Approve this version" }).click();
    await expect(page.getByText("You approved this schedule.")).toBeVisible();
  });

  test("messages preserve context and expose secure attachment controls", async ({ page }) => {
    await page.goto("/client/messages?context=Contract%20signing");
    await expect(page.getByText("New", { exact: true })).toBeVisible();
    await expect(page.locator(".client-message-context")).toContainText("Contract signing");
    await expect(page.getByLabel("Subject")).toHaveValue("Contract signing question");
    await expect(page.getByText(/securely scanned before studio access/i)).toBeVisible();
    await page.getByRole("button", { name: "Reply" }).click();
    await expect(page.getByLabel("Subject")).toHaveValue("Re: Your planning timeline");
  });

  test("records consolidate approved artifacts", async ({ page }) => {
    await page.goto("/client/documents");
    await expect(page.getByRole("heading", { name: "Your records" })).toBeVisible();
    await expect(page.getByText("Retainer invoice")).toBeVisible();
    await expect(page.getByText("Photography gallery")).toBeVisible();
    await expect(page.getByText("Album record")).toBeVisible();
    await expect(page.getByText("Venue certificate of insurance")).toBeVisible();
  });

  test("delivery exposes gallery safeguards and meaningful album revisions", async ({ page }) => {
    await page.goto("/client/delivery");
    await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();
    await page.getByRole("button", { name: "Request a revision" }).click();
    const notes = page.getByLabel("What should your photographer change?");
    await expect(notes).toBeVisible();
    await notes.fill("Please replace the final image on spread four with the alternate portrait.");
    await page.getByRole("button", { name: "Send revision notes" }).click();
    await expect(page.getByText(/revision request was validated/i)).toBeVisible();
  });
});
