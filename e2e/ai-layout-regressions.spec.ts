import { expect, test } from "@playwright/test";

test("AI import panels stay contained at desktop and mobile widths", async ({
  page,
}) => {
  await page.goto("/studio/import");

  const source = page.locator(".template-source-panel");
  const plan = page.locator(".template-plan-panel");
  await expect(source).toBeVisible();
  await expect(plan).toBeVisible();

  const desktop = await page.evaluate(() => {
    const sourceRect = document
      .querySelector(".template-source-panel")!
      .getBoundingClientRect();
    const planRect = document
      .querySelector(".template-plan-panel")!
      .getBoundingClientRect();
    const tabsRect = document
      .querySelector(".template-source-tabs")!
      .getBoundingClientRect();
    return {
      panelsSeparated: sourceRect.right <= planRect.left,
      tabsContained: tabsRect.left >= sourceRect.left && tabsRect.right <= sourceRect.right,
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    };
  });

  expect(desktop.panelsSeparated).toBe(true);
  expect(desktop.tabsContained).toBe(true);
  expect(desktop.horizontalOverflow).toBe(false);

  await page.setViewportSize({ width: 720, height: 1000 });
  const mobile = await page.evaluate(() => {
    const sourceRect = document
      .querySelector(".template-source-panel")!
      .getBoundingClientRect();
    const planRect = document
      .querySelector(".template-plan-panel")!
      .getBoundingClientRect();
    return {
      panelsStacked: planRect.top >= sourceRect.bottom,
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    };
  });

  expect(mobile.panelsStacked).toBe(true);
  expect(mobile.horizontalOverflow).toBe(false);
});

test("AI feedback cards keep readable interior margins", async ({ page }) => {
  await page.goto("/studio/copilot");
  await page
    .getByRole("button", { name: "What needs my attention today?" })
    .click();
  await page.getByRole("button", { name: "Ask Copilot" }).click();

  // The local visual environment intentionally has no AI provider endpoint,
  // so submission renders the error-state card. Result and error cards share
  // this inset rule and therefore cannot regress independently.
  const feedback = page.locator(".copilot-error");
  await expect(feedback).toBeVisible();
  const inset = await feedback.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      left: Number.parseFloat(style.paddingLeft),
      right: Number.parseFloat(style.paddingRight),
      top: Number.parseFloat(style.paddingTop),
      bottom: Number.parseFloat(style.paddingBottom),
    };
  });

  expect(inset.left).toBeGreaterThanOrEqual(20);
  expect(inset.right).toBeGreaterThanOrEqual(20);
  expect(inset.top).toBeGreaterThanOrEqual(20);
  expect(inset.bottom).toBeGreaterThanOrEqual(20);
});

test("calendar exposes availability management as a primary page action", async ({
  page,
}) => {
  await page.goto("/studio/calendar");
  const action = page.getByRole("link", { name: "Manage availability" });
  await expect(action).toBeVisible();
  await expect(action).toHaveAttribute(
    "href",
    "/studio/settings#consultation-availability",
  );
  await action.click();
  await expect(page).toHaveURL(/\/studio\/settings#consultation-availability$/);
  await expect(page.locator("#consultation-availability")).toBeVisible();
});
