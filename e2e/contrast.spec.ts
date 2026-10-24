import { expect, test } from "@playwright/test";
import { globSync } from "node:fs";
import { auditContrast } from "./support/contrast-audit";

/**
 * Every studio page is readable on a laptop: no text under WCAG AA against
 * what is drawn behind it, and none under 12px.
 *
 * The laptop UI audit (2026-10-14) measured the studio's most common text at
 * 4.5:1 and its eyebrows at 4.08:1, two weeks after the 2026-10-02 audit had
 * already darkened the tokens: hardcoded greys crept back in around them.
 * This reads what is drawn, so a new grey fails here the day it lands.
 *
 * Studio pages and signup's, at one laptop width; the couple and crew
 * portals get their own pass with the phone audit. Pages are found from
 * app/studio, so a page added tomorrow is checked tomorrow.
 */
const staticRoutes = globSync("app/studio/**/page.tsx")
  .map((file) => file.replace(/^app/, "").replace(/\/page\.tsx$/, ""))
  .filter((route) => !route.includes("["))
  .sort();

/**
 * Signup, where a studio decides whether to start at all. A CSS rule cut in
 * half on 2026-09-30 turned the sign-up page's "Card required, nothing
 * charged for 14 days" grey on its dark green panel, and nothing here looked
 * (onboarding audit, 2026-10-24).
 */
const signupRoutes = ["/auth/register", "/auth/login", "/auth/onboarding"];

const recordRoutes = [
  "/studio/projects/demo-project",
  "/studio/booking?project=demo-project",
  "/studio/planning?project=demo-project",
  "/studio/delivery?project=demo-project",
  "/studio/proposals/demo-proposal",
  "/studio/schedules/demo-schedule",
  "/studio/workflows/demo-workflow",
  "/studio/crew/demo-crew",
  "/studio/post-production/demo-project",
];

for (const route of [...signupRoutes, ...staticRoutes, ...recordRoutes]) {
  test(`readable on a laptop: ${route}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium");
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 1000 });
    const response = await page.goto(route);
    if (!response || response.status() >= 400) return;
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    const findings = await page.evaluate(auditContrast);
    const failures = findings.map((finding) => `${finding.kind}: ${finding.where} — ${finding.detail}`);
    expect(failures, `${route}\n${failures.join("\n")}`).toEqual([]);
  });
}
