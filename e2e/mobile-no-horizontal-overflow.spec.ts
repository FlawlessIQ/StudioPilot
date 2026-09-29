import { expect, test } from "@playwright/test";

/**
 * No couple, crew or public page is wider than a phone, and none puts two
 * fields side by side on one.
 *
 * The 2026-09-13 mobile pass declared these screens "already mobile-first"
 * from reading the CSS. On the first real phone (2026-09-28) the inquiry form
 * was wider than the screen: a ≤640px rule paired date and type in 156 px
 * columns and the card could not shrink. This walks every route a couple or
 * crew member reaches, at the widths of the phones they carry, and names the
 * elements that stick out. docs/mobile-first-client-crew-plan-2026-09-28.md
 */
const routes = [
  "/kit",
  "/kit?color=%23F2B8C6",
  "/inquiry?studio=demo-studio",
  "/auth/login",
  "/auth/register",
  "/auth/forgot-password",
  "/client",
  "/client/project",
  "/client/proposal",
  "/client/package",
  "/client/contract",
  "/client/payments",
  "/client/documents",
  "/client/messages",
  "/client/questionnaire",
  "/client/schedule",
  "/client/delivery",
  "/client/reviews",
  "/crew",
  "/crew/jobs",
  "/crew/pending",
  "/crew/prep",
  "/crew/schedule",
  "/crew/requirements",
  "/crew/documents",
  "/crew/closeout",
  "/crew/account",
  "/crew/profile",
  "/crew/availability",
];

const widths = [360, 390, 430];

for (const route of routes) {
  test(`fits a phone: ${route}`, async ({ page }, testInfo) => {
    // Widths are set explicitly below. Chrome and Safari's engine both run:
    // an iPhone overflowed where Chrome did not (2026-09-28).
    test.skip(!["desktop-chromium", "iphone-webkit"].includes(testInfo.project.name));
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      const report = await page.evaluate(() => {
        const limit = document.documentElement.clientWidth + 1;
        const offenders: string[] = [];
        for (const element of Array.from(document.body.querySelectorAll("*"))) {
          const box = element.getBoundingClientRect();
          if (box.width === 0 || box.right <= limit) continue;
          // Report the outermost culprits only, not every descendant.
          const parent = element.parentElement?.getBoundingClientRect();
          if (parent && parent.right > limit) continue;
          const name =
            element.tagName.toLowerCase() +
            (element.id ? `#${element.id}` : "") +
            (typeof element.className === "string" && element.className.trim()
              ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}`
              : "");
          offenders.push(`${name} → right edge ${Math.round(box.right)}px`);
        }
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          offenders: offenders.slice(0, 8),
        };
      });
      // No side-by-side fields on a phone. This is the rule the iPhone broke:
      // no desktop engine reproduces how iOS sizes a date input, but the
      // pairing that left it a 156 px column is visible everywhere.
      const paired = await page.evaluate(() => {
        const fields = Array.from(document.querySelectorAll("input, select, textarea")).filter((element) => {
          const type = (element as HTMLInputElement).type;
          if (["checkbox", "radio", "hidden", "file", "submit", "button", "range"].includes(type)) return false;
          if (element.closest('[aria-hidden="true"], .honeypot')) return false;
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        });
        const pairs: string[] = [];
        for (let i = 0; i < fields.length; i++) {
          for (let j = i + 1; j < fields.length; j++) {
            const a = fields[i]!.getBoundingClientRect();
            const b = fields[j]!.getBoundingClientRect();
            const sameRow = Math.abs(a.top - b.top) < 6;
            const apart = a.right <= b.left + 2 || b.right <= a.left + 2;
            if (sameRow && apart) {
              const label = (element: Element) =>
                (element as HTMLInputElement).name || element.getAttribute("aria-label") || element.tagName;
              pairs.push(`${label(fields[i]!)} beside ${label(fields[j]!)}`);
            }
          }
        }
        return pairs;
      });
      expect(paired, `${route} at ${width}px puts fields side by side`).toEqual([]);
      expect(
        report.scrollWidth,
        `${route} at ${width}px is ${report.scrollWidth}px wide:\n  ${report.offenders.join("\n  ")}`,
      ).toBeLessThanOrEqual(report.clientWidth + 1);
    }
  });
}
