import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * A mobile collapse that never applies.
 *
 * `:has()` carries the specificity of its argument, so
 * `.team-state:has(.crew-state-actions)` is 0-2-0 while a plain `.team-state`
 * inside a media query is 0-1-0 — and a media query adds none. The narrow-screen
 * rule written for it therefore lost, silently, at every width.
 *
 * Seen on a real phone: the crew error card kept its desktop
 * icon | text | buttons grid at 375px, squeezing the message into a ribbon a
 * few words wide with the buttons sitting on top of it. The same trap was
 * holding a questionnaire field at six columns.
 *
 * Nothing in the build warns about this — the rule is valid CSS that simply
 * loses — so it is checked here: for every `.x:has(…)` rule that sets a
 * property, any media-query rule collapsing `.x` for narrow screens must name
 * the `:has()` variant too.
 */
const css = readFileSync(`${process.cwd()}/app/globals.css`, "utf8");

type Rule = { selector: string; body: string };

const rules = (source: string): Rule[] =>
  [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1]!.trim(),
    body: match[2]!,
  }));

const properties = (body: string): Set<string> =>
  new Set(
    body
      .split(";")
      .filter((declaration) => declaration.includes(":"))
      .map((declaration) => declaration.split(":")[0]!.trim()),
  );

/** Media blocks and their contents, so a rule's context is known. */
const mediaBlocks = (): string[] =>
  [...css.matchAll(/@media[^{]*\{([\s\S]*?)\n\}/g)].map((match) => match[1]!);

test("no :has() rule silently outranks its own narrow-screen collapse", () => {
  const offenders: string[] = [];
  const insideMedia = mediaBlocks().join("\n");

  for (const rule of rules(css)) {
    const match = /^\.([a-z0-9-]+):has\(/.exec(rule.selector);
    if (!match) continue;
    // A `:has()` rule written *inside* a media query is the override, not the
    // thing being overridden.
    if (insideMedia.includes(rule.selector)) continue;
    const base = match[1]!;
    const set = properties(rule.body);

    for (const block of mediaBlocks()) {
      for (const inner of rules(block)) {
        if (inner.selector.includes(":has(")) continue;
        const collapses = inner.selector
          .split(",")
          .some((part) => part.trim() === `.${base}`);
        if (!collapses) continue;
        const clash = [...properties(inner.body)].filter((property) =>
          set.has(property),
        );
        if (clash.length)
          offenders.push(
            `.${base}:has(…) sets ${clash.join(", ")}; the media rule on .${base} cannot override it — name the :has() variant there too`,
          );
      }
    }
  }
  assert.deepEqual([...new Set(offenders)], []);
});
