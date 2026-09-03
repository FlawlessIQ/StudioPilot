import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every built studio page must be reachable.
 *
 * The Phase 4 nav collapse repointed the account menu's "Studio settings"
 * link from /studio/settings to /studio/setup. Because the collapsed nav has
 * no other settings entry, that one edit stranded three finished pages:
 * /studio/settings and /studio/subscription had *zero* inbound links — a
 * studio owner could not reach their own plan or invoices — and
 * /studio/integrations survived only inside a sentence in a calendar
 * warning. Nothing failed; the pages simply stopped existing as far as
 * anyone using the product was concerned.
 *
 * This walks the route table on disk and fails when a page has nothing
 * pointing at it. Dynamic segments are skipped: they are reached with an id
 * the scan cannot synthesise.
 */

const APP = "app";
/**
 * Every area a signed-in person navigates. It used to be the studio alone,
 * which is how /client/payments stayed orphaned: a couple with an
 * outstanding balance had no link to the page that shows it, and this test
 * passed the whole time because it never looked at the portals.
 */
const AREAS = [
  { root: join(APP, "studio"), prefix: "/studio" },
  { root: join(APP, "client"), prefix: "/client" },
  { root: join(APP, "crew"), prefix: "/crew" },
];

function routesUnder(directory: string, prefix: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (!statSync(full).isDirectory()) continue;
    // A dynamic segment needs a real id to be linked; the scan cannot judge it.
    if (entry.startsWith("[")) continue;
    const route = `${prefix}/${entry}`;
    if (readdirSync(full).includes("page.tsx")) found.push(route);
    found.push(...routesUnder(full, route));
  }
  return found;
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      found.push(...sourceFiles(full));
    } else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Reached with a query parameter or an id from a card, rather than by a
 * literal href anywhere in the source. Each entry is a decision on the
 * record, not a silent gap.
 */
const DEEP_LINK_ONLY = new Map<string, string>([
  // Opened from a job's own tab bar as `?project=…`, never bare.
  ["/studio/event-day", "reached from the job's Plan tab with ?project="],
  ["/studio/post-production", "reached from the job's Delivery tab"],
  ["/studio/readiness", "reached from the readiness link on a job header"],
  ["/studio/audit", "owner-only forensic view, reached from an audit event"],
  ["/studio/copilot", "reached from the composer's escalation link"],
  // Left behind when the crew nav collapsed "Pending offers" and "Accepted
  // jobs" into one "Jobs" entry. /crew/accepted is now a redirect alias to
  // /crew/jobs and so exempt by what it is (see below). /crew/pending still
  // renders and is reached from the home page's invitation cards.
  ["/crew/pending", "superseded by /crew/jobs — dead, pending deletion"],
]);

test("every page behind a login has something linking to it", () => {
  const routes = AREAS.flatMap((area) => routesUnder(area.root, area.prefix));
  /**
   * features/ and lib/ too. The journey engine builds most studio hrefs with
   * `project("/studio/reviews")` and the lifecycle projection assembles them
   * as templates — both in features/, which this never scanned. So the first
   * honest version of the link check reported /studio/reviews stranded when
   * it is the destination of a journey step. The scan has to look where the
   * links are actually written.
   */
  const sources = [
    ...sourceFiles("components"),
    ...sourceFiles("features"),
    ...sourceFiles("lib"),
    ...sourceFiles(APP),
  ].map((path) => readFileSync(path, "utf8"));

  const stranded: string[] = [];
  for (const route of routes) {
    if (DEEP_LINK_ONLY.has(route)) continue;
    // A redirect alias exists precisely so a typed or stale URL does not
    // 404. Having nothing link to it is the point, so it is exempt by what
    // it is rather than by an allowlist entry that could go stale.
    const page = readFileSync(
      join(APP, `${route.replace(/^\//, "")}/page.tsx`),
      "utf8",
    );
    if (/\bredirect\(/.test(page) && !/export const metadata/.test(page))
      continue;
    /**
     * A literal counts only where it is actually a link.
     *
     * This used to accept the route string anywhere in any source file, and
     * the client portal shell keeps every portal route in a plain
     * `new Set([...])` called `contextualRoutes` — so all nine of them
     * "had a link" while the nav rendered four hardcoded entries plus one
     * dynamic slot, and a run of show waiting for the couple's decision was
     * reachable only by typing the URL. The guard was green for the exact
     * pages it exists to protect, which is the same failure
     * tests/readiness-summary.test.ts had: a test naming the right rule and
     * watching the wrong thing.
     *
     * So the literal must sit in a link position — an href, a router push,
     * a redirect — or in a template that builds one.
     *
     * What this still cannot see: whether a link is *rendered*. The portal's
     * server writes `href: "/client/schedule"` into a destination map for
     * every area, which passes here, while the shell rendered only one of
     * them at a time. Proved by removing the schedule entry from the nav and
     * watching this stay green. That rule — an area the server reports is an
     * area the nav shows — is a property of the nav, and lives in
     * tests/portal-navigation.test.ts.
     */
    const linked = sources.some((source) => {
      const path = route.replaceAll("/", "\\/");
      const inLinkPosition = new RegExp(
        `(href\\s*[:=]\\s*\\{?\\s*|\\b(?:push|replace|redirect|permanentRedirect)\\(\\s*)[\`"']${path}(["\`'?#]|\\$\\{)`,
      );
      // A template literal assembling the href elsewhere: `${base}/client/x`
      // or a prefixed constant. Rare, and worth allowing rather than forcing
      // every dynamic link into an exemption.
      const inTemplate = new RegExp(`\\$\\{[^}]*\\}${path}(["\`?#]|\\$\\{)`);
      // A template that opens with the path and appends a query — the shape
      // the project workspace tabs use inside a ternary:
      //   `/studio/booking?project=${projectId}`
      // The first tightening of this test missed it and reported four real
      // tabs as stranded. A path followed by `?name=${` is unambiguously a
      // link being assembled, whatever precedes it.
      const assemblesQuery = new RegExp(`[\`]${path}\\?[a-zA-Z]+=\\$\\{`);
      return inLinkPosition.test(source) || inTemplate.test(source) || assemblesQuery.test(source);
    });
    if (!linked) stranded.push(route);
  }

  assert.deepEqual(
    stranded,
    [],
    stranded.length
      ? `Built but unreachable — nothing links to:\n  ${stranded.join("\n  ")}\n` +
        "Add a link, or add an entry to DEEP_LINK_ONLY explaining how it is reached."
      : "",
  );
});

test("the exemption list stays honest", () => {
  // An exemption for a route that no longer exists is a stale decision.
  const routes = new Set(
    AREAS.flatMap((area) => routesUnder(area.root, area.prefix)),
  );
  const gone = [...DEEP_LINK_ONLY.keys()].filter((route) => !routes.has(route));
  assert.deepEqual(gone, [], `Exempted routes that no longer exist: ${gone.join(", ")}`);
});

/**
 * The public site.
 *
 * AREAS above covers everything behind a login. Nothing ever scanned the
 * marketing pages, which is how /corporate-photographers and
 * /sports-photographers came to be written, shipped, and reachable by
 * nobody — two whole verticals earning nothing — while /studio-preview, a
 * 289-line public product tour, sat unlinked as the homepage sent visitors
 * to /studio and a login form instead.
 */
const PRIVATE_AREAS = new Set([
  "studio", "client", "crew", "platform-admin", "auth", "api",
]);

/**
 * Public pages that are correctly reached without a link from this site.
 * Each is a decision on the record, not a silent gap.
 */
const PUBLIC_STANDALONE = new Map<string, string>([
  ["/inquiry", "a studio's own public lead form, shared by them under their tenant — not StudioCue navigation"],
  ["/offline", "PWA fallback, served by the service worker when the network drops"],
]);

test("every public page has something linking to it", () => {
  const routes = readdirSync(APP)
    .filter((entry) => {
      const full = join(APP, entry);
      return (
        statSync(full).isDirectory() &&
        !PRIVATE_AREAS.has(entry) &&
        !entry.startsWith("[") &&
        !entry.startsWith("_") &&
        readdirSync(full).includes("page.tsx")
      );
    })
    .map((entry) => `/${entry}`)
    .sort();

  assert.ok(routes.length > 5, "found no public pages to check — the scan is broken");

  /**
   * The sitemap does not count as a link.
   *
   * app/sitemap.ts enumerates every public route by design, so including it
   * made this check vacuous for precisely the pages it exists to protect:
   * both orphaned verticals were "linked" by the file whose job is to list
   * them. A sitemap entry tells a crawler the page exists; it does not help
   * a visitor find it, which is the thing being tested.
   */
  const sources = [...sourceFiles("components"), ...sourceFiles(APP)]
    .filter((path) => !/(sitemap|robots)\.tsx?$/.test(path))
    .map((path) => readFileSync(path, "utf8"));

  const stranded: string[] = [];
  for (const route of routes) {
    if (PUBLIC_STANDALONE.has(route)) continue;
    const page = readFileSync(join(APP, `${route.slice(1)}/page.tsx`), "utf8");
    // A redirect alias exists so a typed or stale URL does not 404; having
    // nothing link to it is the point.
    if (/\bredirect\(/.test(page) && !/export const metadata/.test(page)) continue;
    const linked = sources.some((source) =>
      new RegExp(`["\`]${route.replaceAll("/", "\\/")}(["\`?#]|\\$\\{)`).test(source),
    );
    if (!linked) stranded.push(route);
  }

  assert.deepEqual(
    stranded,
    [],
    stranded.length
      ? `Public but unreachable — nothing links to:\n  ${stranded.join("\n  ")}\n` +
        "Add a link, or add an entry to PUBLIC_STANDALONE explaining how it is reached."
      : "",
  );
});
