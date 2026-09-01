/**
 * Proves the inset detector still detects.
 *
 * A clean sweep is only worth something if the detector can fail. This one
 * has reported "no faults" three separate times while measuring nothing at
 * all — once signed out, once against a dev server still compiling the
 * route, once before its own selectors matched. Each looked identical to a
 * pass.
 *
 * So: measure a known-good panel (expect silence), break its inset with an
 * injected rule, measure again (expect a finding). If the second measure
 * is also silent, the detector is broken and every clean run today is
 * meaningless.
 *
 *   npm run dev
 *   npm run audit:selftest
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const detector = readFileSync(join(here, "container-inset.js"), "utf8");
const BASE = process.argv[2] ?? "http://localhost:3000";

const env = (() => {
  try {
    return Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    );
  } catch {
    return {};
  }
})();

/** Insets these deliberately remove, and the panels that should then report. */
const BREAK = `
  .team-invite-panel, .team-invite-panel > form { padding: 0 !important; }
  .crew-cascade-form { padding: 0 !important; }
  .crew-direct-invite-form { padding: 0 !important; }
`;
// The panel's own padding has to go too. This used to zero only the form's
// inset, which was the whole fault back when `.panel` shipped no padding —
// now the panel supplies it, so zeroing the child alone breaks nothing and
// the self-test reported "broken: 0" against a detector that was working
// perfectly. A test that cannot break the thing it tests is the same false
// assurance as a sweep that measures nothing.

/**
 * The other direction: an inset applied twice.
 *
 * A panel supplies the inset for everything under its heading, so a child
 * that also supplies one puts its contents at double. That shipped — three
 * panel families sat at 41px under a 21px heading for hours, and every
 * check at the time asked only whether content was too *close* to an edge,
 * so two clean sweeps and a click-through of every route all passed it.
 *
 * `.panel-heading` must stay silent under this: it pads itself and is
 * pulled back out with a negative margin, which nets to exactly one inset.
 * An arithmetic check that summed the two paddings flagged every heading in
 * the app, which is why the detector measures where content actually lands.
 */
const DOUBLE = `
  .team-invite-panel > form { padding-inline: 26px !important; }
`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

const password = process.env.AUDIT_PASSWORD ?? env.SEED_DEMO_PASSWORD;
if (password) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" });
  const email = page.locator("input[type=email]").first();
  if (await email.count()) {
    await email.fill(process.env.AUDIT_EMAIL ?? "owner@studiohub.test");
    await page.locator("input[type=password]").first().fill(password);
    await page.locator("button[type=submit]").first().click();
    await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 45000 }).catch(() => {});
  }
}

async function measure(route, expectSelector) {
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  // Wait for the panel itself, not a guessed delay: a route the dev server
  // is still compiling renders nothing, and nothing measures clean.
  await page.waitForSelector(expectSelector, { timeout: 30000 });
  await page.evaluate(() => {
    for (const d of document.querySelectorAll("details")) d.open = true;
  });
  await page.waitForTimeout(900);
  const clean = await page.evaluate(detector);
  await page.addStyleTag({ content: BREAK });
  await page.waitForTimeout(400);
  const broken = await page.evaluate(detector);
  return { clean: clean.findings.length, broken: broken.findings.length };
}

/** Same shape, for the doubled-inset direction. */
async function measureDoubled(route, expectSelector) {
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(expectSelector, { timeout: 30000 });
  await page.waitForTimeout(900);
  const clean = await page.evaluate(detector);
  await page.addStyleTag({ content: DOUBLE });
  await page.waitForTimeout(400);
  const after = await page.evaluate(detector);
  return {
    cleanDoubled: clean.findings.filter((f) => f.kind === "doubled").length,
    doubled: after.findings.filter((f) => f.kind === "doubled").length,
  };
}

let ok = true;

const team = await measure("/studio/team", ".team-invite-panel > form");
console.log(`team  — fixed: ${team.clean}, broken: ${team.broken}`);
if (team.clean !== 0 || team.broken === 0) ok = false;

const dbl = await measureDoubled("/studio/team", ".team-invite-panel > form");
console.log(`team  — doubled findings before: ${dbl.cleanDoubled}, after doubling: ${dbl.doubled}`);
if (dbl.cleanDoubled !== 0 || dbl.doubled === 0) ok = false;

await page.goto(`${BASE}/studio/projects`, { waitUntil: "domcontentloaded" });
await page
  .waitForFunction(
    () =>
      [...document.querySelectorAll('a[href^="/studio/projects/"]')].some((a) => {
        const id = a.getAttribute("href").split("/").pop();
        return id && id !== "new";
      }),
    { timeout: 30000 },
  )
  .catch(() => {});
const projectId = await page.evaluate(
  () =>
    [...document.querySelectorAll('a[href^="/studio/projects/"]')]
      .map((a) => a.getAttribute("href").split("/").pop())
      .find((id) => id && id !== "new") ?? null,
);

if (projectId) {
  const crew = await measure(`/studio/crew?project=${projectId}`, ".crew-cascade-form");
  console.log(`crew  — fixed: ${crew.clean}, broken: ${crew.broken}`);
  if (crew.clean !== 0 || crew.broken === 0) ok = false;
} else {
  console.log("crew  — skipped, no project found");
  ok = false;
}

await browser.close();
console.log(
  ok
    ? "\nPASS — silent on fixed panels, fires on broken ones."
    : "\nFAIL — the detector did not behave, so a clean sweep proves nothing.",
);
process.exit(ok ? 0 : 1);
