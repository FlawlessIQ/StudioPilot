import { expect, test } from "@playwright/test";

/**
 * The mobile drawer must leave the accessibility tree when it is closed.
 *
 * It hides by sliding off-screen with a transform, which does nothing for
 * assistive technology: keyboard users could tab into a menu they could not
 * see, and once the bottom tab bar existed every destination was announced
 * twice. `inert` is what removes it, applied only below the drawer breakpoint.
 *
 * The desktop assertions matter at least as much as the mobile ones. If the
 * breakpoint state were ever stale while wide, `inert` would strand the entire
 * sidebar outside the accessibility tree — a worse fault than the one it fixes.
 */

const sidebar = ".ds-sidebar";

test("the desktop sidebar is never inert and stays focusable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/studio");
  await expect(page.locator(sidebar)).toBeVisible();
  await expect(page.locator(sidebar)).not.toHaveAttribute("inert", /.*/);

  const focusable = await page.locator(`${sidebar} a`).first().evaluate((el) => {
    (el as HTMLElement).focus();
    return document.activeElement === el;
  });
  expect(focusable, "a desktop sidebar link must be focusable").toBe(true);
});

test("the closed mobile drawer is inert and its links are unreachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/studio");
  await expect(page.locator(sidebar)).toHaveAttribute("inert", /.*/);

  const focusable = await page.locator(`${sidebar} a`).first().evaluate((el) => {
    (el as HTMLElement).focus();
    return document.activeElement === el;
  });
  expect(focusable, "a closed drawer must not accept focus").toBe(false);

  // The tab bar is the reachable path at this width.
  await expect(page.locator(".ds-tabbar a")).toHaveCount(5);
});

test("opening the mobile drawer restores it, and Escape closes it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/studio");
  await page.locator(".ds-mobile-menu").click();

  await expect(page.locator(".ds-shell")).toHaveClass(/ds-nav-open/);
  await expect(page.locator(sidebar)).not.toHaveAttribute("inert", /.*/);
  const focusable = await page.locator(`${sidebar} a`).first().evaluate((el) => {
    (el as HTMLElement).focus();
    return document.activeElement === el;
  });
  expect(focusable, "an open drawer must accept focus").toBe(true);

  await page.keyboard.press("Escape");
  await expect(page.locator(".ds-shell")).not.toHaveClass(/ds-nav-open/);
  await expect(page.locator(sidebar)).toHaveAttribute("inert", /.*/);
});

test("crossing the breakpoint updates the drawer state", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/studio");
  await expect(page.locator(sidebar)).toHaveAttribute("inert", /.*/);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(sidebar)).not.toHaveAttribute("inert", /.*/);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(sidebar)).toHaveAttribute("inert", /.*/);
});
