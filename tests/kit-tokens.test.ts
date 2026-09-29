import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import tokens from "@/design/tokens.json";
import { kitTokensCss } from "@/features/design/kit-tokens-css";
import {
  MIN_CONTRAST,
  contrastRatio,
  studioTheme,
  studioThemeStyle,
} from "@/features/design/studio-theme";

/**
 * The mobile kit's foundation (M1, docs/mobile-first-client-crew-plan-2026-09-28.md):
 * one token file, and a studio colour that is always readable.
 */

const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

test("app/kit-tokens.css is generated from design/tokens.json and has not drifted", () => {
  assert.equal(
    source("app/kit-tokens.css"),
    kitTokensCss(),
    "run `npx tsx scripts/generate-kit-tokens.ts` after changing design/tokens.json",
  );
});

test("the kit's sizes meet the touch and zoom rules", () => {
  assert.ok(tokens.size.tap >= 44, "tap targets are at least 44 px");
  assert.ok(tokens.size.button >= 44 && tokens.size.input >= 44);
  assert.ok(tokens.text.body.size >= 16, "body text is at least 16 px");
  const kit = source("app/kit.css");
  // iOS zooms into any field under 16 px.
  assert.match(kit, /\.kit-input \{[^}]*font-size: 16px;/);
});

test("the default palette's text reads at AA on ivory and paper", () => {
  for (const text of ["ink", "ink-2", "caption", "brass", "danger"] as const) {
    for (const ground of ["ivory", "paper"] as const) {
      const ratio = contrastRatio(tokens.color[text], tokens.color[ground]);
      assert.ok(ratio >= MIN_CONTRAST, `${text} on ${ground} is ${ratio.toFixed(2)}:1`);
    }
  }
});

test("a studio colour that already reads is used exactly as given", () => {
  for (const color of ["#2D5A45", "#7C2F3B", "#1F3A5F"]) {
    const theme = studioTheme(color);
    assert.equal(theme.accent, color);
    assert.equal(theme.adjusted, false);
  }
});

/**
 * Studios pick pale brand colours (blush, gold, sky). White text on those, or
 * a link in them on ivory, fails. The hue is kept; the colour is darkened
 * until it reads.
 */
test("a pale studio colour is darkened until it reads, never refused", () => {
  for (const pale of ["#F2B8C6", "#E3B23C", "#9AD1F5", "#FFFFFF", "#FFFF00"]) {
    const theme = studioTheme(pale);
    assert.equal(theme.adjusted, true, pale);
    assert.ok(contrastRatio(theme.accent, "#FFFFFF") >= MIN_CONTRAST, `${pale} → ${theme.accent} under white`);
    assert.ok(contrastRatio(theme.accent, tokens.color.paper) >= MIN_CONTRAST, `${pale} → ${theme.accent} on paper`);
    assert.ok(contrastRatio(theme.accent, tokens.color.ivory) >= MIN_CONTRAST, `${pale} → ${theme.accent} on ivory`);
  }
});

test("no colour, or a broken one, gives the default theme", () => {
  const fallback = studioTheme(null).accent;
  assert.equal(fallback, tokens.color["accent-default"]);
  for (const junk of [undefined, "", "green", "#12", "#GGGGGG", "rgb(0,0,0)"]) {
    assert.equal(studioTheme(junk as string | undefined).accent, fallback, String(junk));
  }
  assert.equal(studioTheme("#2d5a45").accent, "#2D5A45", "lower case is accepted");
  assert.equal(studioTheme("#000").accent, "#000000", "three-digit hex is accepted");
});

test("the theme reaches the kit as the variables it reads", () => {
  const style = studioThemeStyle("#7C2F3B");
  assert.equal(style["--kit-accent"], "#7C2F3B");
  const kit = source("app/kit.css");
  for (const variable of Object.keys(style)) {
    assert.ok(kit.includes(`var(${variable})`), `${variable} is used by app/kit.css`);
  }
});

/**
 * The reset must not outrank a component. With `.kit :is(button, …)` the
 * reset (class + element) beat `.kit-button` (class), and a primary button's
 * label inherited ink: dark text on the accent fill (seen in /kit, 2026-09-29).
 */
test("the kit's resets carry no specificity", () => {
  const kit = source("app/kit.css");
  assert.doesNotMatch(kit, /\.kit :is\(/);
  assert.match(kit, /\.kit :where\(button, input, select, textarea\)/);
});
