import { expect, test, type Page } from "@playwright/test";

const studioRoutes = [
  "/studio",
  "/studio/leads",
  "/studio/projects",
  "/studio/calendar",
  "/studio/clients",
  "/studio/tasks",
  "/studio/library",
  "/studio/packages",
  "/studio/proposals",
  "/studio/contracts",
  "/studio/invoices",
  "/studio/booking",
  "/studio/questionnaires",
  "/studio/vendors",
  "/studio/crew",
  "/studio/insurance",
  "/studio/schedules",
  "/studio/readiness",
  "/studio/documents",
  "/studio/messages",
  "/studio/workflows",
  "/studio/automations",
  "/studio/audit",
  "/studio/post-production",
  "/studio/delivery",
  "/studio/reviews",
  "/studio/reports",
  "/studio/integrations",
  "/studio/team",
  "/studio/subscription",
  "/studio/settings",
  "/studio/setup",
  "/studio/notifications",
  "/studio/copilot",
  "/studio/clients/new",
  "/studio/projects/new",
  "/studio/packages/new",
  "/studio/crew/new",
  "/studio/schedules/new",
  "/studio/tasks/new",
  "/studio/workflows/new",
] as const;

const clientRoutes = [
  "/client",
  "/client/project",
  "/client/package",
  "/client/contract",
  "/client/payments",
  "/client/questionnaire",
  "/client/schedule",
  "/client/documents",
  "/client/messages",
  "/client/delivery",
  "/client/reviews",
] as const;

const crewRoutes = [
  "/crew",
  "/crew/pending",
  "/crew/accepted",
  "/crew/schedule",
  "/crew/requirements",
  "/crew/documents",
  "/crew/profile",
  "/crew/availability",
] as const;

const platformRoutes = [
  "/platform-admin",
  "/platform-admin/tenants",
  "/platform-admin/users",
  "/platform-admin/subscriptions",
  "/platform-admin/integrations",
  "/platform-admin/failed-jobs",
  "/platform-admin/feature-flags",
  "/platform-admin/support",
  "/platform-admin/audit-logs",
  "/platform-admin/system-health",
] as const;

async function expectHealthyAuthenticatedShell(page: Page, route: string) {
  await page.goto(route);

  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(page.getByText("StudioCue", { exact: true }).first()).toBeVisible();

  const layout = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
    const invalidInternalLinks = links
      .map((link) => link.getAttribute("href")?.trim() ?? "")
      .filter((href) => href === "" || href === "#");

    return {
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
      invalidInternalLinks,
    };
  });

  expect(layout.horizontalOverflow, `${route} must fit the viewport`).toBe(false);
  expect(layout.invalidInternalLinks, `${route} contains dead links`).toEqual([]);
}

test.describe("authenticated visual shell", () => {
  test.setTimeout(240_000);

  test("Studio routes remain complete and responsive", async ({ page }) => {
    for (const route of studioRoutes) {
      await expectHealthyAuthenticatedShell(page, route);
    }
  });

  test("client portal routes remain complete and responsive", async ({ page }) => {
    for (const route of clientRoutes) {
      await expectHealthyAuthenticatedShell(page, route);
    }
  });

  test("crew portal routes remain complete and responsive", async ({ page }) => {
    for (const route of crewRoutes) {
      await expectHealthyAuthenticatedShell(page, route);
    }
  });

  test("platform administration routes remain complete and responsive", async ({
    page,
  }) => {
    for (const route of platformRoutes) {
      await expectHealthyAuthenticatedShell(page, route);
    }
  });
});
