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
    // `/studio/schedules/new` without a project renders a picker and no
    // generator, so the REVEAL step below has nothing to click and the draft
    // panels are never measured. It only does real work project-scoped.
    "/studio/event-day", "/studio/schedules", "/studio/schedules/new",
    "/studio/readiness",
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
  // Same helper the workspace passes use, for the same reason: a fixed wait
  // here drops the studio workspace on a slow sign-in exactly as it dropped
  // crew and platform admin.
  await signIn(process.env.AUDIT_EMAIL ?? "owner@studiohub.test");
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
/**
 * The subcontractor workspace.
 *
 * This sweep only ever walked /studio, so every crew panel went unmeasured
 * from the day it was written — which is how the job card shipped with a 1px
 * inset and `overflow: hidden`, clipping the first letter of a crew member's
 * own role, and how two lists kept the browser's disc markers alongside the
 * icon that was already the bullet. All found by screenshot, months later.
 *
 * Crew routes need a crew sign-in: a studio owner has no crew membership and
 * lands on a picker or a redirect, which measures nothing and reports clean.
 */
const CREW_ROUTES = [
  "/crew", "/crew/jobs", "/crew/schedule", "/crew/prep", "/crew/requirements",
  "/crew/documents", "/crew/event-day", "/crew/closeout", "/crew/availability",
  "/crew/profile", "/crew/account", "/crew/accepted", "/crew/pending",
];

/**
 * The couple's portal, which needs a third sign-in for the same reason the
 * crew routes need a second: a studio owner has no client membership and is
 * redirected, so a pass as the owner measures nothing and reports clean.
 *
 * Never swept before. The crew workspace was in exactly this position until
 * three days ago and had sat flush since the day it was written; there is no
 * reason to expect the portal to be different, and every reason to look.
 */
const CLIENT_ROUTES = [
  "/client", "/client/project", "/client/proposal", "/client/package",
  "/client/contract", "/client/payments", "/client/questionnaire",
  "/client/schedule", "/client/documents", "/client/messages",
  "/client/delivery", "/client/reviews",
];

/**
 * The platform-admin console, which needs a fourth sign-in.
 *
 * Access is the `platformAdmin` custom claim, not a tenant role, so neither a
 * studio owner nor a subcontractor can reach these — a pass as any of them
 * measures a redirect and reports clean. Ten routes, never swept.
 */
const PLATFORM_ROUTES = [
  "/platform-admin", "/platform-admin/tenants", "/platform-admin/users",
  "/platform-admin/subscriptions", "/platform-admin/integrations",
  "/platform-admin/system-health", "/platform-admin/failed-jobs",
  "/platform-admin/feature-flags", "/platform-admin/audit-logs",
  "/platform-admin/support",
];

/**
 * Every public route, measured signed out.
 *
 * The whole list, not the pages I could see a `.panel` in. Grepping the page
 * files said only `/inquiry` and `/studio-preview` held an audited container —
 * which is true today and is exactly the reasoning that left the crew
 * workspace, the couple's portal and this surface unmeasured for months. A
 * route with no audited container costs one page load and lands in `skipped`;
 * a marketing page that grows a `.panel` next week gets caught for free.
 *
 * Swept last but signed out, because that is the state a visitor is in.
 */
const PUBLIC_ROUTES = [
  "/",
  "/corporate-photographers",
  "/features",
  "/for-clients",
  "/for-crew",
  // No `?studio=`, which is what a stale link on a business card renders.
  "/inquiry",
  /**
   * The form itself, which only renders when the slug resolves to a tenant.
   *
   * Opt-in, because resolving a slug is a live Firestore read through the
   * Admin SDK. Defaulting this to `demo-studio` looked harmless — the page
   * short-circuits that slug in mock data mode — but any server without Admin
   * credentials answers 500, and the sweep then failed the whole run on an
   * environment problem. Point it at a real tenant to measure the form:
   * `AUDIT_INQUIRY_SLUG=<publicSlug>`.
   */
  ...(process.env.AUDIT_INQUIRY_SLUG
    ? [`/inquiry?studio=${process.env.AUDIT_INQUIRY_SLUG}`]
    : []),
  "/integrations",
  "/offline",
  "/pricing",
  "/privacy",
  "/sports-photographers",
  "/start-trial",
  "/studio-preview",
  "/support",
  "/terms",
  "/wedding-photographers",
];

const routes = projectId ? [...ROUTES, ...projectScoped(projectId)] : ROUTES;

let flush = 0;
let narrow = 0;
let other = 0;
const skipped = [];

/**
 * Routes the sweep could not confirm it had actually looked at.
 *
 * Distinct from `skipped`, which is a detector that returned nothing. This is
 * a page that never finished rendering inside the budget, so "no findings"
 * means "no measurement" — and reporting that as clean is how a fault survives
 * a sweep that claims to cover it.
 */
const unverified = [];

/** Routes whose two readings disagreed, so neither is trustworthy. */
const unstable = [];

/** A workspace the sweep could not sign in to, so none of it was measured. */
const misdirected = [];

/**
 * Routes actually measured, counted rather than inferred.
 *
 * This was `routes.length - skipped - unverified`, and `routes` is only the
 * studio list — so the crew pass never counted toward it and the summary
 * under-reported its own coverage by thirteen routes. With the portal added it
 * would have been twenty-five.
 */
let measured = 0;

/**
 * The same routes at phone width, checking one thing: does the page scroll
 * sideways.
 *
 * The sweep measured every route at 1440px and passed, while the client
 * portal was unusable on a phone — a payment link in a message preview has
 * no space to break at, so it ran 828px wide inside a 390px screen and took
 * the whole document with it. Nothing above catches that, because the
 * element is inset correctly; it is the viewport it overflows, not its
 * container.
 *
 * Reported with the widest offending element, because "the page scrolls" on
 * its own sends you hunting.
 */
/**
 * Evaluate in the page, tolerating a navigation landing mid-call.
 *
 * Firestore hydrates after paint and some routes redirect once they know who
 * you are, so an evaluate issued a fixed delay after goto can be destroyed by
 * a navigation it did not cause. One retry after a settle turns that from a
 * crashed run into a measured one.
 */
async function evaluateSettled(fn, arg) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await page.evaluate(fn, arg);
    } catch (error) {
      if (!String(error).includes("Execution context was destroyed")) throw error;
      await page.waitForTimeout(1500);
    }
  }
  return null;
}

async function measureNarrow(routes) {
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    await measureNarrowRoutes(routes);
  } finally {
    // Always, not just on the happy path. `evaluateSettled` rethrows anything
    // that is not a destroyed execution context, and the restore below used to
    // sit after that call: one throw here and every later workspace was
    // measured at 390px while reporting itself as a desktop pass.
    await page.setViewportSize({ width: 1440, height: 1200 });
  }
}

async function measureNarrowRoutes(routes) {
  for (const route of routes) {
    try {
      await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 20000 });
    } catch {
      // Measure whatever rendered, as above.
    }
    await page.waitForTimeout(1200);
    const finding = await evaluateSettled(() => {
      const limit = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth <= limit + 1) return null;
      let worst = null;
      for (const element of document.querySelectorAll("body *")) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.right <= limit + 1) continue;
        if (!worst || box.right > worst.right) {
          worst = {
            right: Math.round(box.right),
            tag: element.tagName.toLowerCase(),
            cls: (element.className || "").toString().slice(0, 60),
            text: (element.textContent || "").trim().slice(0, 50),
          };
        }
      }
      return { scrollWidth: document.documentElement.scrollWidth, limit, worst };
    });
    if (!finding) continue;
    narrow += 1;
    console.log(`${route}  [390px]`);
    console.log(
      `  overflow  page is ${finding.scrollWidth}px wide in a ${finding.limit}px viewport` +
        (finding.worst
          ? ` — widest is <${finding.worst.tag} class="${finding.worst.cls}"> at ${finding.worst.right}px  "${finding.worst.text}"`
          : ""),
    );
  }
}

/**
 * Panels that do not exist until someone acts.
 *
 * /studio/schedules/new was in the route list from the start and was reported
 * clean every run, because on first paint it is a form and nothing else. The
 * draft — the run of show, what it was based on, the questions to ask, the
 * publish boundary — is four panels that mount only after Generate, so the
 * detector had never once looked at them. They shipped flush against the
 * border and the sweep said the route was fine.
 *
 * A route whose real content is behind a click has to be clicked. Anything
 * added here is measured in the state the studio actually reads.
 */
const REVEAL = [
  {
    match: (route) => route.startsWith("/studio/schedules/new"),
    // The generator can take a while: it is an AI call in mock mode but still
    // a round trip. Wait for the draft panels themselves, not a fixed delay.
    async run(page) {
      const button = page.locator("button[type=submit]").first();
      if (!(await button.count()) || !(await button.isEnabled().catch(() => false))) return;
      await button.click().catch(() => {});
      await page
        .waitForSelector(".schedule-draft-items, .schedule-basis", { timeout: 45000 })
        .catch(() => {});
    },
  },
];

async function reveal(route) {
  const step = REVEAL.find((r) => r.match(route));
  if (!step) return;
  await step.run(page).catch(() => {});
  await page.evaluate(() => {
    for (const d of document.querySelectorAll("details")) d.open = true;
  });
  await page.waitForTimeout(900);
}

async function measure(route) {
  try {
    await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 20000 });
  } catch {
    // Slow data pages settle after load; measure what rendered anyway.
  }

  /**
   * Wait for the page to exist before measuring it.
   *
   * This was `waitForTimeout(1200)`. The auth boundary renders "Opening your
   * workspace / Checking your secure studio access…" until the membership
   * resolves, and on a cold dev server that routinely takes twenty to thirty
   * seconds — /studio/settings among them. At 1.2s the shell holds no audited
   * container at all, the detector found nothing, and `measure` returned
   * without recording anything: the route was reported clean having never been
   * looked at. That is why the same pages kept coming back after each fix.
   *
   * The `findProject` helper above already learned this lesson — "a fixed
   * timeout silently skipped every project-scoped route on a slow run" — and
   * the fix was never carried into the measuring path.
   */
  const rendered = await page
    .waitForFunction(
      () => {
        const body = document.body?.innerText ?? "";
        if (/Checking your secure studio access|Opening your workspace/.test(body)) {
          return false;
        }
        /**
         * Substantive content, judged without naming a class.
         *
         * The first version listed container classes — `.panel`, `.ds-card` and
         * friends — and three routes have none of them: /studio/import,
         * /studio/messages and /studio/proposals build their own containers. All
         * three render perfectly and all three were reported NEVER RENDERED,
         * which is the same false negative as the silent pass, wearing the
         * opposite label. A rendered page has prose in its main region; a
         * loading shell has one sentence, and it is matched above.
         */
        const main = document.querySelector("main") ?? document.body;
        return (main.innerText ?? "").trim().length > 120;
      },
      { timeout: 45000 },
    )
    .then(() => true)
    .catch(() => false);

  if (!rendered) {
    unverified.push(route);
    return;
  }

  /**
   * Wait for the CSS to have arrived, not for a guess at how long it takes.
   *
   * 658 of the padding rules live in legacy-bridge.css under `.ds-root`, in a
   * stylesheet chunk that loads separately from the markup. Measure before it
   * lands and every panel in the app reports zero inset: the first run of this
   * gate used a 400ms settle and produced 129 findings where a 2100ms one
   * produced 6 — the same pages, the same CSS, a different moment.
   *
   * A fixed delay cannot be right, because it is either too short on a slow
   * load or wasted on a fast one. This waits for the actual precondition: every
   * stylesheet parsed, fonts resolved, and then two identical measurements in a
   * row, so a sweep whose answer still depended on timing would say so by
   * disagreeing with itself rather than by reporting a number.
   */
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('link[rel="stylesheet"]')].every(
          (link) => link.sheet !== null,
        ),
      { timeout: 20000 },
    )
    .catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(500);
  // Open every disclosure before measuring. The detector skips the contents
  // of a closed <details>, because Chromium lays them out and reports them
  // as visible even though the disclosure clips them — but a panel folded
  // behind a summary is still a panel someone opens, and the crew direct
  // invite form is one of them. Measure the state the studio actually sees.
  await page.evaluate(() => {
    for (const d of document.querySelectorAll("details")) d.open = true;
  });
  await page.waitForTimeout(900);
  await reveal(route);
  let report = await evaluateSettled(detector);
  if (!report) {
    skipped.push(route);
    return;
  }
  /**
   * The same measurement twice. If the second disagrees, the page was still
   * settling and the first reading was fiction — say so rather than print it.
   */
  await page.waitForTimeout(700);
  const confirm = await evaluateSettled(detector);
  if (!confirm || confirm.findings.length !== report.findings.length) {
    unstable.push(
      `${route} (${report.findings.length} then ${confirm ? confirm.findings.length : "none"})`,
    );
    return;
  }
  report = confirm;
  measured += 1;
  if (!report.findings.length) return;
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

await warm(routes);
for (const route of routes) await measure(route);

/**
 * Second pass, as a subcontractor.
 *
 * Signing out matters: Firebase keeps the session in IndexedDB, so without
 * it the crew routes are walked as a studio owner, who has no crew
 * membership and gets a redirect. That measures nothing and reports clean —
 * the exact failure this sweep exists to avoid.
 */
/**
 * Swap identity, then walk that workspace's routes.
 *
 * There is no /auth/logout route, so the session is cleared where it actually
 * lives. Firebase keeps it in IndexedDB; localStorage and cookies go too so
 * nothing re-hydrates the previous user on the next navigation.
 */
async function clearSession() {
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    const dbs = (await indexedDB.databases?.()) ?? [];
    await Promise.all(dbs.map((d) => d.name
      ? new Promise((done) => {
          const request = indexedDB.deleteDatabase(d.name);
          request.onsuccess = request.onerror = request.onblocked = done;
        })
      : null));
  }).catch(() => {});
  await page.context().clearCookies();
}

/**
 * Sign in, waiting for the sign-in page to actually go away.
 *
 * This was `waitForTimeout(6000)`. Establishing the session is a round trip
 * to Auth plus a membership read, and when it ran long the sweep navigated
 * away mid-flight and landed back on /auth/login — reported as "could not
 * enter the workspace", which reads like a bad account rather than a slow
 * one. Observed on crew one run and platform admin the next, so it is timing,
 * not credentials: a whole workspace dropping out of the audit at random.
 */
async function signIn(email) {
  await clearSession();
  await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const field = page.locator("input[type=email]").first();
  if (!(await field.count())) return false;
  await field.fill(email);
  await page.locator("input[type=password]").first().fill(password);
  await page.locator("button[type=submit]").first().click();
  await page
    .waitForFunction(() => !location.pathname.startsWith("/auth/login"), {
      timeout: 45000,
    })
    .catch(() => {});
  return true;
}

const pathOf = () => {
  try {
    return new URL(page.url()).pathname;
  } catch {
    return "";
  }
};

/**
 * Compile the routes before measuring them.
 *
 * The dev server builds a route the first time it is asked for one, and the
 * render gate in `measure` gives a page 45s to produce content. On a cold walk
 * the pages late in the run pay compilation on top of hydration, blow that
 * budget, and are recorded NEVER RENDERED — nine of them on one run, all of
 * which measured clean the moment the routes were warm. That is a property of
 * the harness, not of the pages, and it is the difference between a coverage
 * gap and a finding.
 *
 * `waitUntil: "commit"` is deliberate: it returns as soon as the response
 * begins, which is exactly when the server-side compile has finished, and
 * costs nothing waiting for a render this pass is going to throw away.
 */
async function warm(routes) {
  for (const route of routes) {
    await page.goto(BASE + route, { waitUntil: "commit", timeout: 60000 }).catch(() => {});
  }
}

async function walkAs(email, workspaceRoutes, label) {
  const prefix = workspaceRoutes[0];
  let entered = false;
  for (let attempt = 1; attempt <= 3 && !entered; attempt += 1) {
    if (!(await signIn(email))) return;
    await page.goto(BASE + prefix, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    entered = pathOf().startsWith(prefix);
    if (!entered && attempt < 3) {
      console.log(`  retrying ${label} sign-in as ${email} (landed on ${pathOf()})`);
    }
  }
  /**
   * Confirm the sign-in landed in the right workspace before measuring.
   *
   * Signing in as somebody with no membership for these routes redirects, and
   * a pass that measures the redirect target reports the wrong workspace as
   * clean — which is the whole failure this sweep exists to catch, and it
   * would now be silent in a *second* way.
   */
  if (!entered) {
    const at = pathOf();
    console.log(`\nCould not enter the ${label} workspace as ${email} after 3 attempts — landed on ${at}. Not measured.`);
    misdirected.push(`${label} (${email} -> ${at})`);
    return;
  }
  await warm(workspaceRoutes);
  for (const route of workspaceRoutes) await measure(route);
  await measureNarrow(workspaceRoutes);
}

if (password) {
  await walkAs(process.env.AUDIT_CREW_EMAIL ?? "crew@studiohub.test", CREW_ROUTES, "crew");
  await walkAs(process.env.AUDIT_CLIENT_EMAIL ?? "client@studiohub.test", CLIENT_ROUTES, "client portal");
  await walkAs(
    process.env.AUDIT_PLATFORM_EMAIL ?? "platform@studiohub.test",
    PLATFORM_ROUTES,
    "platform admin",
  );
}

/**
 * Public pages, signed out — the state a visitor is actually in. Last, because
 * it is the one pass that must not carry a session, and clearing one is easier
 * than avoiding it.
 */
await clearSession();
await warm(PUBLIC_ROUTES);
for (const route of PUBLIC_ROUTES) await measure(route);

await browser.close();

const audited = measured;
if (skipped.length) {
  console.log(`\nSkipped ${skipped.length} route(s) that rendered nothing to measure.`);
}
/**
 * A route that never rendered is louder than a clean one, and it fails.
 *
 * The whole point: "no findings" on a page the sweep never saw is the same
 * output as "no findings" on a page it checked, and that ambiguity is what let
 * the settings page keep its flush form through several rounds of fixes.
 */
if (misdirected.length) {
  console.log(`\nWORKSPACE NOT ENTERED — none of its routes measured (${misdirected.length}):`);
  for (const entry of misdirected) console.log(`  ${entry}`);
}
if (unstable.length) {
  console.log(
    `\nUNSTABLE — measured twice and disagreed, so not reported either way (${unstable.length}):`,
  );
  for (const route of unstable) console.log(`  ${route}`);
}
if (unverified.length) {
  console.log(
    `\nNEVER RENDERED — not measured, not clean (${unverified.length}):`,
  );
  for (const route of unverified) console.log(`  ${route}`);
}
console.log(
  flush || other
    ? `\n${flush} flush, ${other} overflow/bleed across ${audited} audited route(s).`
    : `\nNo inset faults across ${audited} audited route(s).`,
);
console.log(
  narrow
    ? `${narrow} route(s) scroll sideways at 390px.`
    : "No page overflows a phone viewport.",
);
if (!audited) {
  console.error("Measured nothing — treating as a failure rather than a pass.");
  process.exit(2);
}
// `flush` and `narrow` gate. Both are deterministic: a panel either supplies
// an inset or it does not, and a page either fits a 390px viewport or it does
// not. Overflow and bleed depend on what happens to be expanded or loaded
// when the sweep arrives, so they are worth reading and wrong to fail on.
process.exit(
  flush || narrow || unverified.length || unstable.length || misdirected.length
    ? 1
    : 0,
);
