import { expect, test } from "@playwright/test";

test("photographer navigation exposes five durable destinations", async ({ page }) => {
  await page.goto("/studio");
  const links = page.locator(".ds-nav-item");
  await expect(links).toHaveCount(5);
  await expect(links).toHaveText(["Home", "Projects", "Calendar", "Messages", "People"]);
  await expect(page.locator(".ds-sidebar")).not.toContainText("AI review");
  await expect(page.locator(".ds-sidebar")).not.toContainText("Event day");
  await expect(page.locator(".ds-sidebar")).not.toContainText("Deliveries");
});

test("home presents one next decision without duplicate dashboard concepts", async ({ page }) => {
  await page.goto("/studio");
  await expect(page.locator(".studio-focus-hero")).toBeVisible();
  await expect(page.getByText("Your next decision", { exact: true })).toBeVisible();
  await expect(page.getByText("Put AI to work", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Next actions", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Every project, from hello to gallery", { exact: true })).toHaveCount(0);
});

test("project workspace uses four outcome-based tabs", async ({ page }) => {
  await page.goto("/studio/projects/demo-project");
  const nav = page.getByRole("navigation", { name: "Project workspace" });
  await expect(nav.getByRole("link")).toHaveCount(4);
  await expect(nav.getByRole("link")).toHaveText(["Overview", "Client & booking", "Plan", "Delivery"]);
  await nav.getByRole("link", { name: "Plan" }).click();
  await expect(page).toHaveURL(/\/studio\/planning\?project=demo-project/);
  await expect(page.getByRole("heading", { name: "Plan", exact: true })).toBeVisible();
});

test("messages reveal the editor only after intent is established", async ({ page }) => {
  await page.goto("/studio/messages");
  await expect(page.getByRole("heading", { name: "Messages", exact: true })).toBeVisible();
  await expect(page.locator(".communications-draft-review")).toHaveCount(0);
  await page.getByLabel("Project").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Write it myself" }).click();
  await expect(page.locator(".communications-draft-review")).toBeVisible();
  await expect(page.getByLabel("Subject")).toBeVisible();
});

test("delivery asks for project context before showing the release workflow", async ({ page }) => {
  await page.goto("/studio/delivery");
  await expect(page.getByText("Choose the project to deliver", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Secure gallery URL")).toHaveCount(0);
  await page.getByLabel("Project").selectOption({ index: 1 });
  await expect(page.getByLabel("Secure gallery URL")).toBeVisible();
  await expect(page.getByText("Follow-ups and studio defaults", { exact: true })).toBeVisible();
});
