import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { EXPLAINERS, explainer } from "@/features/help/explainers";
import { GLOSSARY, glossaryTerm } from "@/features/help/glossary";
import { boldLabels, plainText } from "@/features/help/rich-text";
import { helpForRoute, routeMatches } from "@/features/help/routes";
import { helpVideo, helpVideoIds } from "@/features/help/videos";
import { JOURNEY_VIDEO_IDS } from "@/features/journey/expected-timeline";
import { MARKETING_FILM_IDS } from "@/features/marketing/media";

/**
 * Help that describes a screen as it used to be is worse than no help
 * (docs/how-to-videos-plan-2026-09-30.md §5). These hold the explainers and
 * the glossary to the product: every button a guide names still exists, every
 * route it answers for is a real page, every ⓘ points at a real word.
 */

function walk(dir: string, match: (file: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, match, out);
    else if (match(full)) out.push(full);
  }
  return out;
}

/** Source text as a reader sees it: entities decoded, apostrophes one shape. */
const normalise = (text: string) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&apos;|&rsquo;|&#39;|’/g, "'")
    .replace(/&ldquo;|&rdquo;|“|”/g, '"')
    .replace(/&mdash;/g, "—");

const PRODUCT_SOURCE = normalise(
  [...walk("components", (file) => /\.tsx?$/.test(file)), ...walk("app", (file) => /\.tsx?$/.test(file)), ...walk("features", (file) => /\.tsx?$/.test(file) && !file.startsWith(path.join("features", "help")))]
    .map((file) => readFileSync(file, "utf8"))
    .join("\n"),
);

/** Every page route in app/, as a pattern with dynamic segments as `*`. */
const PAGE_ROUTES = walk("app", (file) => file.endsWith(`${path.sep}page.tsx`)).map((file) => {
  const route = path
    .dirname(file)
    .split(path.sep)
    .slice(1)
    .filter((part) => !/^\(.*\)$/.test(part))
    .map((part) => (part.startsWith("[") ? "*" : part))
    .join("/");
  return `/${route}`;
});

const allText = (guide: (typeof EXPLAINERS)[number]) =>
  [guide.purpose, ...guide.steps, guide.next ?? "", ...(guide.goodToKnow ?? [])];

test("explainer and glossary ids are unique and URL-safe", () => {
  for (const list of [EXPLAINERS.map((guide) => guide.id), GLOSSARY.map((term) => term.id)]) {
    assert.equal(new Set(list).size, list.length, "duplicate id");
    for (const id of list) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/, id);
  }
  assert.ok(!explainer("glossary"), "'glossary' is the /how-to/glossary page, not a guide id");
  assert.ok(!explainer("wedding-journey"), "'wedding-journey' is the /how-to/wedding-journey page, not a guide id");
});

test("every UI label a guide names in bold still exists in the product", () => {
  const missing: string[] = [];
  for (const guide of EXPLAINERS)
    for (const text of allText(guide))
      for (const label of boldLabels(text))
        if (!PRODUCT_SOURCE.includes(normalise(label))) missing.push(`${guide.id}: **${label}**`);
  assert.deepEqual(missing, [], "rename the label in the guide, or restore it on the screen");
});

test("every route a guide answers for is a real page", () => {
  for (const guide of EXPLAINERS)
    for (const route of [...guide.routes, ...(guide.alsoOn ?? [])]) {
      const matched = PAGE_ROUTES.some((page) => routeMatches(route, page) || routeMatches(page, route.replace(/\/\*\*$/, "")));
      assert.ok(matched, `${guide.id}: ${route} matches no app/**/page.tsx`);
    }
});

/** The hrefs of a `const <name>: readonly Tab[] = [...]` list in a shell. */
function tabHrefs(file: string, name: string): string[] {
  const source = readFileSync(file, "utf8");
  const start = source.indexOf(`export const ${name}`);
  assert.ok(start >= 0, `${name} in ${file}`);
  const block = source.slice(start, source.indexOf("];", start));
  return [...block.matchAll(/href: "([^"]+)"/g)].map((match) => match[1]);
}

test("every studio, couple and crew tab opens a guide of its own", () => {
  const client = tabHrefs("components/layout/portal-shell.tsx", "clientTabs");
  const crew = tabHrefs("components/crew/crew-portal-shell.tsx", "crewTabs");
  assert.ok(client.length >= 4 && crew.length >= 4);
  for (const href of client)
    assert.equal(helpForRoute(href, "couple").fallback, false, href);
  for (const href of crew) assert.equal(helpForRoute(href, "crew").fallback, false, href);
  for (const href of ["/studio", "/studio/leads", "/studio/projects", "/studio/help"])
    assert.equal(helpForRoute(href, "studio").fallback, false, href);
});

test("a screen with no guide of its own falls back to its audience's tour", () => {
  assert.equal(helpForRoute("/studio/audit", "studio").primary.id, "tour");
  assert.equal(helpForRoute("/studio/audit", "studio").fallback, true);
  assert.equal(helpForRoute("/client/some-new-screen", "couple").primary.id, "couple-tour");
  assert.equal(helpForRoute("/crew/some-new-screen", "crew").primary.id, "crew-tour");
});

test("the most specific route wins, and a guide's related list never repeats it", () => {
  assert.equal(helpForRoute("/studio/projects/abc123", "studio").primary.id, "job-page");
  assert.equal(helpForRoute("/studio/booking", "studio").primary.id, "contract-retainer");
  const booking = helpForRoute("/studio/booking", "studio");
  assert.ok(booking.related.some((guide) => guide.id === "proposal"), "proposal is offered on the Booking tab");
  assert.ok(!booking.related.some((guide) => guide.id === booking.primary.id));
  assert.ok(routeMatches("/studio/proposals/**", "/studio/proposals/p1/preview"));
  assert.ok(!routeMatches("/studio/leads/*", "/studio/leads"));
});

test("every glossary word a guide or an ⓘ uses exists, and each hint stays short", () => {
  for (const guide of EXPLAINERS)
    for (const id of guide.terms ?? []) assert.ok(glossaryTerm(id), `${guide.id} → term ${id}`);
  const used = [...PRODUCT_SOURCE.matchAll(/<InfoHint term="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(used.length >= 2);
  for (const id of used) assert.ok(glossaryTerm(id), `<InfoHint term="${id}"> has no glossary entry`);
  for (const term of GLOSSARY) {
    const words = term.hint.split(/\s+/).length;
    assert.ok(words <= 30, `${term.id}: ${words} words`);
    if (term.explainer) assert.ok(explainer(term.explainer), `${term.id} → ${term.explainer}`);
  }
});

test("each explainer is a guide, not an essay", () => {
  for (const guide of EXPLAINERS) {
    const words = allText(guide).map(plainText).join(" ").split(/\s+/).length;
    assert.ok(words >= 80 && words <= 260, `${guide.id}: ${words} words`);
    assert.ok(guide.steps.length >= 3 && guide.steps.length <= 7, `${guide.id}: ${guide.steps.length} steps`);
    assert.ok((guide.goodToKnow ?? []).length <= 3, `${guide.id}: at most three notes`);
  }
});

test("videos are only shown once the pipeline has published them", () => {
  // A video belongs to an explainer, or is the wedding film and its chapters
  // ("A wedding, start to finish", features/journey/expected-timeline.ts).
  // Or it is one of the website's narrated films, opened from a marketing page.
  for (const id of helpVideoIds())
    assert.ok(
      EXPLAINERS.some((guide) => guide.video === id) ||
        JOURNEY_VIDEO_IDS.includes(id) ||
        (MARKETING_FILM_IDS as readonly string[]).includes(id),
      `${id} has no explainer`,
    );
  for (const id of MARKETING_FILM_IDS)
    assert.ok(
      ["app/page.tsx", "app/office-manager/page.tsx"].some((page) => readFileSync(page, "utf8").includes(`videoId="${id}"`)),
      `${id} is published but no marketing page opens it`,
    );
  assert.equal(helpVideo("today", undefined), null, "no media base, no video");
  assert.equal(helpVideo("not-a-video", "https://example.test"), null);
  const [first] = helpVideoIds();
  if (first) {
    const template = helpVideo(first, "https://media.test/o/public%2Fhow-to%2F{file}?alt=media")!;
    assert.match(template.src, /^https:\/\/media\.test\/o\/public%2Fhow-to%2F[^/?]+\.mp4\?alt=media$/);
    assert.match(helpVideo(first, "https://media.test/how-to/")!.src, /^https:\/\/media\.test\/how-to\/[^/]+\.mp4$/);
  }
});
