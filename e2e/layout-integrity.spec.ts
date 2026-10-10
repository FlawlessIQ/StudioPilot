import { expect, test } from "@playwright/test";
import { globSync } from "node:fs";
import { auditLayout } from "./support/layout-audit";

/**
 * No page squeezes text to a word per line, draws one thing on top of
 * another, or runs wider than the window — at the widths people use.
 *
 * Today's "Get your inquiries in" card shipped broken on every desk-sized
 * window (2026-10-09): a viewport rule put its chips in an `auto` grid track
 * beside the text, the chips took the width, and the heading wrapped one word
 * per line with its sentence hidden under the buttons. Nothing checked. The
 * phone-width guard (mobile-no-horizontal-overflow.spec.ts) only asks whether
 * a page is wider than the screen, and this card was not.
 *
 * Every page is found from app/**\/page.tsx, so a page added tomorrow is
 * checked tomorrow without anyone remembering to list it. Pages that need a
 * record get the demo records mock mode serves. The audit itself is
 * e2e/support/layout-audit.ts — the same source runs in a browser console
 * for a walk on production.
 */
const staticRoutes = globSync("app/**/page.tsx")
  .map((file) => file.replace(/^app/, "").replace(/\/page\.tsx$/, "") || "/")
  // Route groups — (marketing) — are not in the URL.
  .map((route) => route.replace(/\/\([^)]+\)/g, "") || "/")
  // Pages that need a token or an id are covered by the records below.
  .filter((route) => !route.includes("["))
  .sort();

const recordRoutes = [
  "/studio/projects/demo-project",
  "/studio/planning?project=demo-project",
  "/studio/proposals/demo-proposal",
  "/studio/proposals/demo-proposal/preview",
  "/studio/schedules/demo-schedule",
  "/studio/workflows/demo-workflow",
  "/studio/crew/demo-crew",
  "/studio/post-production/demo-project",
  // A group event on the day, and its printed sign (sign-up, 2026-10-10).
  "/studio/projects/demo-project/field",
  "/studio/projects/demo-project/sign",
  "/crew/schedule?assignment=demo-upcoming",
  "/crew/requirements?assignment=demo-upcoming",
];

/**
 * A studio's desk (1024 is a laptop with the sidebar open; the card above
 * broke at every one of these), and a phone. Height is generous so a page's
 * first screen holds most of what it renders.
 */
const widths = [1024, 1280, 1536, 390];

for (const route of [...staticRoutes, ...recordRoutes]) {
  test(`nothing squeezed, overlapped or overflowing: ${route}`, async ({ page }, testInfo) => {
    // Widths are set here, so one project is enough.
    test.skip(testInfo.project.name !== "desktop-chromium");
    test.setTimeout(90_000);
    const failures: string[] = [];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      const response = await page.goto(route);
      // A route that redirects or 404s in mock mode has nothing of its own to audit.
      if (!response || response.status() >= 400) return;
      await page.waitForLoadState("networkidle");
      // Web fonts change line breaks; measure what a person sees.
      await page.evaluate(() => document.fonts.ready);
      const findings = await page.evaluate(auditLayout);
      for (const finding of findings) failures.push(`${width}px ${finding.kind}: ${finding.where} — ${finding.detail}`);
    }
    expect(failures, `${route}\n${failures.join("\n")}`).toEqual([]);
  });
}
