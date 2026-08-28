import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Nothing a subcontractor taps at a venue may be smaller than a fingertip.
 *
 * The crew workspace is built for a phone — the components are literally named
 * `crew-mobile-page` — and every previous audit walked it at 1512px wide. At
 * phone width two controls were unusable:
 *
 *   - Edit and Remove availability rendered at **15×15** CSS pixels, side by
 *     side, one of them destructive. The likeliest outcome of aiming at Edit on
 *     a phone was deleting the entry.
 *   - "Directions" was 36px tall — the highest-stakes tap in the product, made
 *     by a second photographer standing outside a venue.
 *
 * WCAG 2.5.5 asks for 44×44. Asserted against the stylesheet because measuring
 * it needs a browser: e2e/portal-spacing-regressions.spec.ts already runs these
 * routes under the Pixel 7 project and is where a rendered check belongs.
 */

const css = readFileSync(`${process.cwd()}/app/globals.css`, "utf8");

/** Selectors whose rule must carry a 44px floor, and why. */
const MUST_BE_TAPPABLE: Array<[string, string]> = [
  [
    ".crew-availability-actions button",
    "icon-only Edit and Remove, adjacent, one destructive",
  ],
  [
    ".crew-event-location a",
    "Directions, tapped outside a venue",
  ],
];

const ruleFor = (selector: string): string => {
  const at = css.indexOf(selector);
  assert.notEqual(at, -1, `${selector} has no rule at all`);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open, close);
};

test("every named crew touch target has a 44px floor", () => {
  for (const [selector, why] of MUST_BE_TAPPABLE) {
    const rule = ruleFor(selector);
    const height = /min-height:\s*(\d+)px/.exec(rule);
    assert.ok(height, `${selector} (${why}) declares no min-height`);
    assert.ok(
      Number(height[1]) >= 44,
      `${selector} (${why}) is ${height[1]}px tall; WCAG 2.5.5 asks for 44`,
    );
  }
});

test("an icon-only control also has a width floor", () => {
  // A 44px-tall button 15px wide is still a miss. Text buttons stretch on their
  // own; icon-only ones do not.
  const rule = ruleFor(".crew-availability-actions button");
  const width = /min-width:\s*(\d+)px/.exec(rule);
  assert.ok(width, "the icon-only availability buttons declare no min-width");
  assert.ok(Number(width[1]) >= 44, `min-width is ${width[1]}px, not 44`);
});

test("the icon buttons centre their glyph", () => {
  // Growing the box without centring leaves the icon in a corner, so the
  // visible target and the real one disagree.
  const rule = ruleFor(".crew-availability-actions button");
  assert.match(rule, /align-items:\s*center/);
  assert.match(rule, /justify-content:\s*center/);
}); 
