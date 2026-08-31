import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

/**
 * Can the inset rules actually reach the elements they name?
 *
 * scripts/audit/sweep.mjs measures the rendered truth across 94 routes and four
 * workspaces, and it is the authority — but it needs a production build, a
 * running emulator with seed data, four sign-ins and about five minutes, so it
 * cannot gate a push.
 *
 * This is the fast half. It does not measure anything; it asserts the three
 * ways an inset rule was found to be correct-but-unreachable in one week:
 *
 *   1. The rule lived in a CSS chunk the page never loaded. `app/globals.css`
 *      is split, and the chunk holding the panel-inset block plus its
 *      `--panel-inset` token was absent from /studio/settings and
 *      /crew/schedule — no padding rule for `.studio-identity` or
 *      `.crew-brief-panel` was reachable from the page at all.
 *   2. The rule named an ancestor that does not exist.
 *      `.admin-content .ops-table .ops-row` never matched anything, because
 *      `.admin-content` is in no component, so platform rows kept a 4px inset.
 *   3. A `.panel` usage supplied no inset at all, from either its own class or
 *      the shared block — the plain case, and the one the screenshot showed.
 */

const REPO = process.cwd();
const read = (path: string) => readFileSync(`${REPO}/${path}`, "utf8");

/** Every class name that appears in a component's markup. */
const componentClasses = (() => {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(`${REPO}/${dir}`, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const next = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.tsx?$/.test(entry.name)) {
        const text = readFileSync(`${REPO}/${next}`, "utf8");
        for (const match of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`)/g)) {
          for (const name of (match[1] ?? match[2] ?? "").split(/[\s${}?:'"()]+/)) {
            if (name) found.add(name);
          }
        }
      }
    }
  };
  for (const root of ["components", "app", "features"]) walk(root);
  return found;
})();

const INSET_FILE = "app/legacy-bridge.css";

test("the panel-inset block and its token share one stylesheet", () => {
  /**
   * The token has to resolve in the same sheet as the rules that read it. Split
   * across chunks, `var(--panel-inset, 26px)` reached pages whose chunk had
   * neither, and the whole block was inert.
   */
  const sheet = read(INSET_FILE);
  assert.match(
    sheet,
    /--panel-inset:\s*26px/,
    `${INSET_FILE} must define --panel-inset alongside the rules that use it`,
  );
  assert.match(
    sheet,
    /Headless panels: nothing inside supplies the inset/,
    `the panel-inset block must live in ${INSET_FILE}, which the studio, crew, ` +
      "client and platform routes all load — globals.css is split and its " +
      "chunk is not on those pages",
  );
});

/** The selectors inside the panel-inset block. */
const insetSelectors = (() => {
  const sheet = read(INSET_FILE);
  const start = sheet.indexOf("Headless panels: nothing inside supplies the inset");
  assert.notEqual(start, -1, "panel-inset block not found");
  const block = sheet.slice(start);
  return [...block.matchAll(/^\s*(\.[a-z][a-z0-9-]*)(?:\s*>\s*\.[a-z][a-z0-9-]*)?\s*[,{]/gim)]
    .map((match) => match[1]!.slice(1));
})();

test("every class the inset block names exists in a component", () => {
  assert.ok(insetSelectors.length >= 8, `only found ${insetSelectors.length} selectors`);
  const orphans = insetSelectors.filter((name) => !componentClasses.has(name));
  assert.deepEqual(
    orphans,
    [],
    "these classes are styled but rendered by nothing, so the rule can never " +
      "match — the shape that left the platform-admin rows at 4px",
  );
});

test("no dead ancestor selectors in the stylesheets that carry insets", () => {
  /**
   * `.admin-content .ops-table .ops-row { padding-inline: 24px }` looked like a
   * fix and matched nothing for as long as it existed. Any descendant selector
   * whose *ancestor* class is in no component is in that position.
   */
  const offenders: string[] = [];
  /**
   * Scoped to the sheet that carries insets. globals.css also holds a dead
   * `.sidebar` theme — `.sidebar .tenant-switcher`, `.sidebar .user-card` and
   * the rest, from a shell the `ds-` design system replaced — which this same
   * check finds and which is a separate cleanup, not an inset fault.
   */
  for (const file of [INSET_FILE]) {
    const css = read(file);
    for (const match of css.matchAll(
      /(^|\})\s*\.([a-z][a-z0-9-]*)\s+\.[a-z][a-z0-9-]*[^{}]*\{([^}]*padding[^}]*)\}/gim,
    )) {
      const ancestor = match[2]!;
      if (!componentClasses.has(ancestor)) {
        offenders.push(`${file}: .${ancestor} …`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a padding rule is scoped under a class no component renders, so it has " +
      "never applied",
  );
});

/**
 * Deliberately not asserted here: "every `.panel <name>` declares padding".
 *
 * It is too strict to be true. A panel is correctly inset when its *contents*
 * are, and several are — `.ops-table` delegates the inset to its rows so the
 * row hover background can span the full width, and the heading-led panels let
 * `.panel-heading` carry the top. A static rule that demanded padding on the
 * panel itself flagged fifteen panels the sweep measures as clean, and a guard
 * that cries wolf gets bypassed.
 *
 * Whether the rendered contents actually clear the border is a measurement, and
 * scripts/audit/sweep.mjs is the thing that measures it. `npm run sweep`.
 */
