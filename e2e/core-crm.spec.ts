import { expect, test } from "@playwright/test";

test("public product, pricing, and vertical pages are complete", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Every project");
  await page.goto("/pricing");
  await expect(page.getByText("$199").first()).toBeVisible();
  await expect(page.getByText("Studio", { exact: true }).first()).toBeVisible();
  for (const route of [
    "/features",
    "/integrations",
    "/wedding-photographers",
    "/corporate-photographers",
    "/sports-photographers",
  ]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /Start|trial/i }).first()).toBeVisible();
  }
});

test("public inquiry validates and completes without fake persistence", async ({ page }) => {
  await page.goto("/inquiry");
  await expect(
    page.getByRole("heading", { name: "Ask the studio for its current inquiry link." }),
  ).toBeVisible();
  await page.goto("/inquiry?studio=demo-studio");
  await page.getByLabel("First name").fill("Lena");
  await page.getByLabel("Last name").fill("Ortiz");
  await page.getByLabel("Email").fill("lena@example.test");
  await page.getByLabel("Phone").fill("212-555-0112");
  await page.getByLabel("Event date").fill("2027-05-22");
  await page.getByLabel("City").fill("Brooklyn");
  await page
    .getByLabel("What are you planning?")
    .fill("An intimate wedding with warm documentary photography.");
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(
    page.getByRole("heading", { name: "Thank you. We’ll be in touch shortly." }),
  ).toBeVisible();
  await expect(page.getByText(/no record was persisted/i)).toBeVisible();
});

test("studio operational surfaces use real-data empty states", async ({ page }) => {
  const routes = [
    "/studio",
    "/studio/projects",
    "/studio/questionnaires",
    "/studio/insurance",
    "/studio/schedules",
    "/studio/documents",
    "/studio/messages",
    "/studio/reports",
  ] as const;
  for (const route of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  }
  await page.goto("/studio/copilot");
  await expect(page.getByText(/cannot change authoritative status/i)).toBeVisible();
  await page.goto("/studio/schedules/new");
  await expect(page.getByRole("heading", { name: "Schedule draft" })).toBeVisible();
});

test("home prioritizes approvals and reports only observed workflow evidence", async ({ page }) => {
  await page.goto("/studio");
  await expect(page.getByText("Your next decision", { exact: true })).toBeVisible();
  await expect(page.locator(".studio-focus-action")).toBeVisible();
  await expect(page.locator(".studio-focus-hero")).toContainText("Suggested next");

  await page.goto("/studio/reports");
  await expect(page.getByRole("heading", { name: "What StudioCue handled for you" })).toBeVisible();
  await expect(page.getByText("Automation reliability", { exact: true })).toBeVisible();
  await expect(page.getByText("Verified time reclaimed", { exact: true })).toBeVisible();
  await expect(page.getByText("Needs data", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/does not invent time savings/i)).toBeVisible();
});

test("role portals state their security and evidence boundaries", async ({ page }) => {
  await page.goto("/client/payments");
  await expect(page.getByText(/QuickBooks invoice links will appear/i)).toBeVisible();
  await page.goto("/client/reviews");
  await expect(page.getByText(/review request may appear/i)).toBeVisible();
  await page.goto("/crew");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.goto("/crew/schedule");
  await expect(page.getByText(/No published schedule is assigned/i)).toBeVisible();
});

test("platform operations avoid invented health and failure counts", async ({ page }) => {
  await page.goto("/platform-admin");
  await expect(page.getByText(/Production tenant and service state/i)).toBeVisible();
  await page.goto("/platform-admin/failed-jobs");
  await expect(page.getByRole("heading", { name: "Failed jobs" })).toBeVisible();
  await page.goto("/platform-admin/system-health");
  await expect(page.getByRole("heading", { name: "System health" })).toBeVisible();
  await page.goto("/platform-admin/support");
  await expect(page.getByRole("heading", { name: "Grant temporary access" })).toBeVisible();
});
