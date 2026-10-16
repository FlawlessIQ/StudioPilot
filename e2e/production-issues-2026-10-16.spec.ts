import { expect, test } from "@playwright/test";

test("Inquiries does not load the public preview before it is opened", async ({ page }) => {
  const previews: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/inquiry" && url.searchParams.get("preview") === "studio") previews.push(url.pathname);
  });
  await page.goto("/studio/leads");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("link", { name: "Preview inquiry form" })).toBeVisible();
  expect(previews).toEqual([]);
});

test("search finds package setup from the subscription page and supports the keyboard", async ({ page }, testInfo) => {
  await page.goto("/studio/subscription");
  await page.getByRole("button", { name: "Search StudioCue", exact: true }).click();
  const search = page.getByRole("dialog", { name: "Search StudioCue" });
  const input = search.getByRole("textbox");
  await input.fill("Add packages");
  await expect(search.getByRole("link", { name: /Add a package/ })).toHaveAttribute("href", "/studio/packages/new");
  await page.screenshot({ path: testInfo.outputPath("search-add-packages.png") });
  await input.press("ArrowDown");
  await expect(search.getByRole("link", { name: /Add a package/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/studio\/packages\/new$/);
});

test("Today opens an inquiry editor on one click", async ({ page }, testInfo) => {
  await page.goto("/studio");
  const edit = page.getByRole("button", { name: "Edit", exact: true }).first();
  await expect(edit).toBeVisible();
  await edit.click();
  const sheet = page.getByRole("dialog", { name: "Review prepared action" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("textbox", { name: "Edited subject", exact: true })).toBeVisible();
  const message = sheet.getByRole("textbox", { name: "Edited message body" });
  await message.fill("My updated reply to this inquiry.");
  await page.screenshot({ path: testInfo.outputPath("today-inquiry-editor.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(message).toHaveValue("My updated reply to this inquiry.");
});
