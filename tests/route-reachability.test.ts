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
const STUDIO = join(APP, "studio");

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
]);

test("every studio page has something linking to it", () => {
  const routes = routesUnder(STUDIO, "/studio");
  const sources = [
    ...sourceFiles("components"),
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
    // Its own page file does not count as an inbound link.
    const linked = sources.some((source) => {
      const withQuery = new RegExp(
        `["\`]${route.replaceAll("/", "\\/")}(["\`?#]|\\$\\{)`,
      );
      return withQuery.test(source);
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
  const routes = new Set(routesUnder(STUDIO, "/studio"));
  const gone = [...DEEP_LINK_ONLY.keys()].filter((route) => !routes.has(route));
  assert.deepEqual(gone, [], `Exempted routes that no longer exist: ${gone.join(", ")}`);
});
