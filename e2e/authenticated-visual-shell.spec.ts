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
  "/client/proposal",
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
    const invisibleActionText = Array.from(
      document.querySelectorAll<HTMLElement>("button, a.button"),
    )
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          bounds.width > 0 &&
          bounds.height > 0 &&
          (element.textContent?.trim().length ?? 0) > 0 &&
          style.opacity !== "0" &&
          style.color === style.backgroundColor
        );
      })
      .map((element) => element.textContent?.trim() ?? "");

    return {
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
      invalidInternalLinks,
      invisibleActionText,
    };
  });

  expect(layout.horizontalOverflow, `${route} must fit the viewport`).toBe(false);
  expect(layout.invalidInternalLinks, `${route} contains dead links`).toEqual([]);
  expect(
    layout.invisibleActionText,
    `${route} contains actions whose text matches their background`,
  ).toEqual([]);
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

  test("client proposal decision remains clear and responsive", async ({ page }) => {
    await page.goto("/client/proposal");
    await expect(
      page.getByRole("heading", { name: "Signature wedding" }),
    ).toBeVisible();
    await expect(page.getByText("$7,356.00", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: /Accept proposal/i }).click();
    await expect(
      page.getByRole("button", { name: "Confirm acceptance" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Go back" }).click();
    await page.getByRole("button", { name: "Request changes" }).click();
    await expect(
      page.getByLabel("What would you like your studio to change?"),
    ).toBeVisible();
    expect(
      await page
        .getByRole("heading", { name: "Signature wedding" })
        .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(40);
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

  test("dynamic record workflows remain usable and legible", async ({ page }) => {
    await expectHealthyAuthenticatedShell(page, "/studio/projects/demo-project");
    await expect(page.locator(".project-phase")).toHaveCount(5);
    await expect(
      page.locator('.project-phase[aria-current="step"] strong'),
    ).toHaveText("Planning");
    await expect(
      page.getByRole("link", { name: /Review readiness/i }),
    ).toBeVisible();
    await page.getByText("Update project stage", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Confirm Ready" }),
    ).toBeVisible();

    for (const route of [
      "/studio/leads/LD-1087",
      "/studio/proposals/demo-proposal",
      "/studio/crew/demo-crew",
      "/studio/post-production/demo-project",
      "/studio/schedules/demo-schedule",
      "/studio/workflows/demo-workflow",
    ]) {
      await expectHealthyAuthenticatedShell(page, route);
    }

    await page.goto("/studio/proposals/demo-proposal/preview");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Signature wedding" }),
    ).toBeVisible();
  });
});
