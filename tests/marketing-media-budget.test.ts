import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import test from "node:test";
import { webpSize } from "@/features/marketing/webp-size";

/**
 * Fewer videos, better visuals (docs/marketing-visuals-plan-2026-10-03.md §6).
 *
 * Conor scrolled the live site on 2026-10-03 and found "a website with
 * endless videos": thirteen loops and players below the fold, each asking
 * for attention, so none of them led. The rule now: one moving thing per
 * page, up front, and a still for every other section — a real screen with
 * pins, phone screens, or a diagram. How-to videos are links that open in
 * the film's dialog, not players on the page.
 *
 * Checked in the source, like tests/marketing-claims.test.ts: each page and
 * every component it renders, followed through its imports.
 */
const read = (path: string) => readFileSync(path, "utf8");
/** The source without comments, so a comment naming a player isn't one. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const PAGES = [
  "app/page.tsx",
  "app/features/page.tsx",
  "app/for-clients/page.tsx",
  "app/for-crew/page.tsx",
  "app/wedding-photographers/page.tsx",
  "app/corporate-photographers/page.tsx",
  "app/sports-photographers/page.tsx",
  "app/pricing/page.tsx",
  "app/integrations/page.tsx",
];

/** What plays: a <video> of the page's own, or a component that renders one. */
const PLAYERS = ["HelpVideoPlayer", "LoopVideo", "PhoneVideo", "TrialTeaser"];
/** The players themselves: counted where they're used, not where they're built. */
const PLAYER_SOURCES = new Set([
  "components/help/video-player.tsx",
  "components/marketing/loop-video.tsx",
  "components/marketing/trial-teaser.tsx",
]);
/**
 * Players that exist only once someone presses Watch: the film's dialog
 * mounts its player while open and not before. Asserted below, so a change
 * that renders it on the page fails here.
 */
const ON_DEMAND = new Set(["components/help/journey-film.tsx"]);

function resolveImport(specifier: string): string | null {
  if (!specifier.startsWith("@/components/")) return null;
  const base = specifier.slice(2);
  for (const candidate of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`]) if (existsSync(candidate)) return candidate;
  return null;
}

/** A page and every component it renders, through its imports. */
function reachable(page: string): string[] {
  const seen = new Set<string>([page]);
  const queue = [page];
  while (queue.length) {
    const file = queue.shift()!;
    if (PLAYER_SOURCES.has(file)) continue;
    for (const match of read(file).matchAll(/from "(@\/components\/[^"]+)"/g)) {
      const next = resolveImport(match[1]!);
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [...seen];
}

function playersIn(file: string): string[] {
  if (PLAYER_SOURCES.has(file) || ON_DEMAND.has(file)) return [];
  const source = code(file);
  const found: string[] = [];
  const tags = [...PLAYERS, "video", "iframe"];
  for (const tag of tags) {
    const count = source.match(new RegExp(`<${tag}\\b`, "g"))?.length ?? 0;
    for (let index = 0; index < count; index++) found.push(`${file}: <${tag}>`);
  }
  return found;
}

test("every marketing page plays at most one thing", () => {
  for (const page of PAGES) {
    assert.ok(existsSync(page), `${page} is gone — drop it from this list`);
    const players = reachable(page).flatMap(playersIn);
    assert.ok(players.length <= 1, `${page} plays ${players.length} things; one, up front, is the rule:\n${players.join("\n")}`);
  }
});

test("the homepage's one moving thing is the hero loop; the chapter stops are stills", () => {
  const players = reachable("app/page.tsx").flatMap(playersIn);
  assert.deepEqual(players, ["app/page.tsx: <LoopVideo>"]);
  assert.match(code("app/page.tsx"), /<LoopVideo[^>]*id="hero-loop"/);
  const stops = code("components/marketing/home-journey.tsx");
  assert.match(stops, /<img\b/, "the chapter stops are pictures");
  assert.doesNotMatch(stops, /<video\b|HelpVideoPlayer|LoopVideo/, "the chapter stops are pictures, not players");
});

test("the film's dialog mounts its player only once it's opened", () => {
  const dialog = code("components/help/journey-film.tsx");
  assert.match(dialog, /if \(!video \|\| !open\) return null;/);
  assert.equal((dialog.match(/<HelpVideoPlayer\b/g) ?? []).length, 1, "one player, inside the dialog");
});

test("no marketing page uses the website's loops other than the hero (mk-loop-* stay published, unused)", async () => {
  const { MARKETING_MEDIA } = await import("@/features/marketing/media");
  const loops = Object.entries(MARKETING_MEDIA)
    .filter(([id, entry]) => entry.kind === "loop" && id !== "hero-loop")
    .map(([id]) => id);
  for (const page of PAGES)
    for (const file of reachable(page)) {
      if (PLAYER_SOURCES.has(file)) continue;
      const source = code(file);
      for (const match of source.matchAll(/<LoopVideo\b[^>]*\bid="([^"]+)"/g))
        assert.equal(match[1], "hero-loop", `${file} plays the ${match[1]} loop`);
      // A loop's poster is a still (the gallery stop uses one); the clip itself is not.
      for (const match of source.matchAll(/marketingMedia\("([a-z-]+)"\)(\?\.posterSrc)?/g))
        if (loops.includes(match[1]!)) assert.ok(match[2], `${file} uses the ${match[1]} loop, not just its poster`);
    }
});

// ── The stills ─────────────────────────────────────────────────────────

type ScreenEntry = { alt: string; phone: boolean; width: number; height: number };
const SCREENS = JSON.parse(read("features/marketing/screens.json")) as Record<string, ScreenEntry>;
const MAX_BYTES = 150 * 1024;

test("every screenshot exists at 1× and 2×, under 150 KB, with its true size and alt text", () => {
  for (const [name, entry] of Object.entries(SCREENS)) {
    for (const file of [`public/marketing/${name}.webp`, `public/marketing/${name}@2x.webp`]) {
      assert.ok(existsSync(file), `${file} is missing: run npx tsx scripts/marketing/screens.ts ${name}`);
      assert.ok(statSync(file).size < MAX_BYTES, `${file} is ${statSync(file).size} bytes; keep each under 150 KB`);
    }
    const one = webpSize(readFileSync(`public/marketing/${name}.webp`));
    const two = webpSize(readFileSync(`public/marketing/${name}@2x.webp`));
    assert.deepEqual({ width: entry.width, height: entry.height }, one, `${name}: screens.json's size is not the file's`);
    assert.deepEqual(two, { width: one.width * 2, height: one.height * 2 }, `${name}@2x is not twice the 1× file`);
    assert.ok(entry.alt.length >= 40, `${name} needs alt text that says what it shows`);
    assert.doesNotMatch(entry.alt, /^(image|screenshot|picture) of/i, `${name}: say what it shows, not that it's an image`);
  }
});

test("nothing in public/marketing is unlisted, and every still a page names exists", () => {
  for (const file of readdirSync("public/marketing")) {
    const name = file.replace(/(@2x)?\.webp$/, "");
    assert.ok(SCREENS[name], `public/marketing/${file} isn't in features/marketing/screens.json, so it has no alt text`);
  }
  const named = new Set<string>();
  for (const page of PAGES)
    for (const file of reachable(page)) {
      const source = code(file);
      for (const match of source.matchAll(/\bscreen(?:=|: )"([a-z0-9-]+)"/g)) named.add(match[1]!);
      for (const match of source.matchAll(/["'`](\/marketing\/[^"'`]+)["'`]/g))
        assert.ok(existsSync(`public${match[1]}`), `${file} points at ${match[1]}, which doesn't exist`);
    }
  assert.ok(named.size >= 10, "the pages name their stills with screen=\"…\"; this check found too few to trust it");
  for (const name of named) assert.ok(SCREENS[name], `a page names the still "${name}", which isn't in screens.json`);
});

test("stills load lazily, carry their size and both resolutions", () => {
  const source = code("components/marketing/screen-shot.tsx");
  assert.match(source, /loading="lazy"/);
  assert.match(source, /width=\{screen\.width\}/);
  assert.match(source, /height=\{screen\.height\}/);
  assert.match(source, /srcSet=\{screen\.srcSet\}/);
  assert.match(source, /alt=\{screen\.alt\}/);
  assert.match(read("features/marketing/screens.ts"), /@2x\.webp 2x/);
});
