import { expect, test } from "@playwright/test";

/**
 * The couple's Messages and Files tabs at phone width (M4 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md), against the mock records
 * in components/client/live-client-views.tsx. Build in mock mode:
 *
 *   NEXT_PUBLIC_DATA_MODE=mock NEXT_PUBLIC_AUTH_MODE=mock \
 *   NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true NEXT_PUBLIC_CRM_FUNCTIONS_URL= npm run build
 */

test.use({ serviceWorkers: "block" });

test("messages are a chat: bubbles, no subject, a composer that sends", async ({ page }) => {
  await page.goto("/client/messages");
  const thread = page.getByRole("list", { name: "Conversation" });
  await expect(thread.locator(".kit-chat-message[data-from='studio']")).toHaveCount(2);
  await expect(thread.locator(".kit-chat-message[data-from='you']")).toHaveCount(1);
  await expect(page.getByLabel("Subject")).toHaveCount(0);

  const box = page.getByRole("textbox", { name: /^Message / });
  const send = page.getByRole("button", { name: "Send" });
  await expect(send).toBeDisabled();
  await box.fill("Perfect, thank you!\nSee you at the shoot.");
  await send.click();
  await expect(thread.locator(".kit-chat-message[data-from='you']")).toHaveCount(2);
  await expect(thread.getByText(/Perfect, thank you!/)).toBeVisible();
  await expect(box).toHaveValue("");
  // The composer sits in the thumb zone, above the tabs, not at the end of the page.
  const composer = await page.locator(".kit-composer").boundingBox();
  const tabs = await page.locator(".kit-tabbar").boundingBox();
  expect(composer && tabs && composer.y + composer.height <= tabs.y + 1).toBe(true);
});

test("files: a shared photo previews in place; booking records open their screens", async ({ page }) => {
  await page.goto("/client/documents");
  await expect(page.getByRole("heading", { name: "Your files" })).toBeVisible();
  await page.getByRole("button", { name: /Venue walkthrough\.jpg/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("img", { name: "Venue walkthrough.jpg" })).toBeVisible();
  await expect(sheet.getByRole("link", { name: /Open full size/ })).toHaveAttribute("target", "_blank");
  await page.keyboard.press("Escape");

  // A PDF opens in the phone's own viewer, which shows every page.
  await expect(page.getByRole("link", { name: /Venue certificate of insurance/ })).toHaveAttribute("target", "_blank");
  await page.getByRole("link", { name: /Retainer invoice/ }).click();
  await expect(page).toHaveURL(/\/client\/payments$/);
});
