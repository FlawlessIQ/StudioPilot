/**
 * Runs container-inset.js across the workspace.
 *
 * The detector next to this file has existed for a while and is good; what
 * was missing was anything that ran it. It was written to be pasted into a
 * page by hand, so it only ever saw the route someone happened to be
 * looking at — which is why flush panels kept being found by screenshot,
 * one at a time, months apart.
 *
 *   npm run dev
 *   npm run audit:insets
 *
 * Signs itself in, because with NEXT_PUBLIC_AUTH_MODE=live every studio
 * route otherwise redirects to the login screen and the sweep reports a
 * clean run having measured nothing. Uses the seeded emulator owner and
 * SEED_DEMO_PASSWORD from .env.local; override with AUDIT_EMAIL and
 * AUDIT_PASSWORD. Playwright's storageState is deliberately not used: the
 * Firebase web SDK keeps its session in IndexedDB, which storageState does
 * not capture, so restoring one yields a signed-out browser that looks
 * fine and measures nothing.
 *
 * A route that renders no container counts as skipped, not passed, and a
 * run that measures nothing exits non-zero — a guard that can pass
 * silently is worse than no guard.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const detector = readFileSync(join(here, "container-inset.js"), "utf8");
const BASE = process.argv[2] ?? "http://localhost:3000";

const ROUTES = [
  "/studio", "/studio/ai-queue", "/studio/audit", "/studio/automations",
  "/studio/booking", "/studio/calendar", "/studio/clients", "/studio/clients/new",
  "/studio/contracts", "/studio/copilot", "/studio/crew", "/studio/crew/new",
  "/studio/delivery", "/studio/documents", "/studio/event-day", "/studio/import",
  "/studio/insights", "/studio/insurance", "/studio/integrations", "/studio/invoices",
  "/studio/leads", "/studio/library", "/studio/messages", "/studio/notifications",
  "/studio/packages", "/studio/packages/new", "/studio/planning",
  "/studio/post-production", "/studio/projects", "/studio/projects/new",
  "/studio/proposals", "/studio/proposals/new", "/studio/questionnaires",
  "/studio/readiness", "/studio/reports", "/studio/reviews", "/studio/schedules",
  "/studio/schedules/new", "/studio/settings", "/studio/setup", "/studio/subscription",
  "/studio/tasks", "/studio/tasks/new", "/studio/team", "/studio/vendors",
  "/studio/workflows", "/studio/workflows/new",
];

/**
 * Views that only exist once a job is selected — the crew plan among them,
 * which is where this was last reported. Without a `?project=` they render
 * a picker instead, so a sweep that skips them misses a class of panel
 * entirely. The id is discovered so this works against any dataset.
 */
const projectScoped = (id) =>
  [
    "/studio/crew", "/studio/planning", "/studio/booking", "/studio/delivery",
    "/studio/event-day", "/studio/schedules", "/studio/readiness",
    "/studio/insurance", "/studio/documents", "/studio/contracts", "/studio/invoices",
  ]
    .map((route) => `${route}?project=${id}`)
    .concat(`/studio/projects/${id}`);

function envFile() {
  try {
    return Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split("\n")
        .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
        .map((line) => [
          line.slice(0, line.indexOf("=")).trim(),
          line.slice(line.indexOf("=") + 1).trim(),
        ]),
    );
  } catch {
    return {};
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

const env = envFile();
const password = process.env.AUDIT_PASSWORD ?? env.SEED_DEMO_PASSWORD;
if (password) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const emailField = page.locator("input[type=email]").first();
  if (await emailField.count()) {
    await emailField.fill(process.env.AUDIT_EMAIL ?? "owner@studiohub.test");
    await page.locator("input[type=password]").first().fill(password);
    await page.locator("button[type=submit]").first().click();
    await page.waitForTimeout(6000);
  }
}

// domcontentloaded, not networkidle: Firestore holds a live listener socket
// open on every workspace route, so the network is never idle and the page
// only ever times out.
try {
  await page.goto(`${BASE}/studio/projects`, { waitUntil: "domcontentloaded", timeout: 30000 });
} catch {
  // Fall through: a project id is a nicety, not a precondition.
}
// Wait for the list to arrive rather than guessing at a delay: Firestore
// hydrates after paint, and a fixed timeout silently skipped every
// project-scoped route on a slow run.
// Twice, because a cold dev server compiles this route on first request
// and can spend the whole budget doing it — in which case the first
// attempt finds nothing and every project-scoped route is silently
// dropped from the sweep.
const findProject = async () => {
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('a[href^="/studio/projects/"]')].some((a) => {
          const id = a.getAttribute("href").split("/").pop();
          return id && id !== "new";
        }),
      { timeout: 25000 },
    )
    .catch(() => {});
  return page.evaluate(
    () =>
      [...document.querySelectorAll('a[href^="/studio/projects/"]')]
        .map((a) => a.getAttribute("href").split("/").pop())
        .find((id) => id && id !== "new") ?? null,
  );
};
let projectId = await findProject();
if (!projectId) {
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  projectId = await findProject();
}
if (!projectId) console.log("No project found — project-scoped views not swept.\n");
const routes = projectId ? [...ROUTES, ...projectScoped(projectId)] : ROUTES;

let flush = 0;
let other = 0;
const skipped = [];

for (const route of routes) {
  try {
    await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 20000 });
  } catch {
    // Slow data pages settle after load; measure what rendered anyway.
  }
  await page.waitForTimeout(1200);
  const report = await page.evaluate(detector);
  if (!report) {
    skipped.push(route);
    continue;
  }
  if (!report.findings.length) continue;
  for (const f of report.findings) {
    if (f.kind === "flush") flush += 1;
    else other += 1;
  }
  console.log(route);
  for (const f of report.findings) {
    const where = `.${f.container.split(/\s+/).join(".")}`;
    if (f.kind === "flush")
      console.log(`  flush     ${where} — ${f.child} ${f.gap}px from the ${f.side} edge  "${f.text}"`);
    else if (f.kind === "overflow")
      console.log(`  overflow  ${where} — ${f.child} runs ${-f.gap}px past the ${f.side} edge  "${f.text}"`);
    else
      console.log(`  bleed     ${where} — ${f.rules} full-width rule(s), e.g. ${f.example}`);
  }
}

await browser.close();

const audited = routes.length - skipped.length;
if (skipped.length) {
  console.log(`\nSkipped ${skipped.length} route(s) that rendered nothing to measure.`);
}
console.log(
  flush || other
    ? `\n${flush} flush, ${other} overflow/bleed across ${audited} audited route(s).`
    : `\nNo inset faults across ${audited} audited route(s).`,
);
if (!audited) {
  console.error("Measured nothing — treating as a failure rather than a pass.");
  process.exit(2);
}
// Only `flush` gates. It is deterministic: a panel either supplies an inset
// or it does not. Overflow and bleed depend on what happens to be expanded
// or loaded when the sweep arrives, so they are worth reading and wrong to
// fail a build on.
process.exit(flush ? 1 : 0);
