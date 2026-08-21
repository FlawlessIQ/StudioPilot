import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { familyTone, type KindTone } from "@/features/library/kinds";

/**
 * The kind palette is only useful if its hues stay distinct from the
 * primary accent and legible on their own tints. Both properties are easy
 * to break by editing a hex in a stylesheet, and neither is visible in a
 * screenshot until someone squints at the wrong screen — mint spent a
 * release one degree from the primary before anyone measured it.
 */

const css = readFileSync("app/studiocue-reimagined.css", "utf8");
const designSystem = readFileSync("app/design-system.css", "utf8");

/** The foreground each tone paints its glyph in, read from the live rule. */
function toneForeground(tone: KindTone): string {
  const rule = new RegExp(
    `\\.kind-glyph\\.tone-${tone}\\s*\\{[^}]*color:\\s*(#[0-9a-f]{6})`,
    "i",
  ).exec(css);
  assert.ok(rule, `.kind-glyph.tone-${tone} declares no colour`);
  return rule[1];
}

/** The soft tint behind it, read from the token block. */
function toneBackground(tone: KindTone): string {
  const token = new RegExp(`--cue-${tone}-soft:\\s*(#[0-9a-f]{6})`, "i").exec(css);
  assert.ok(token, `--cue-${tone}-soft is not defined`);
  return token[1];
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(v.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function hue(hex: string): number {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h =
    max === r
      ? ((g - b) / d) % 6
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function hueDistance(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d);
}

const tones = [...new Set(Object.values(familyTone))];

test("every kind tone is legible on its own tint at icon contrast", () => {
  // 3:1 is the WCAG floor for non-text graphics, which is what these are.
  // Four of the five sit below 4.5:1, which is exactly why the rule is that
  // a tone tints a tile and never sets label text.
  for (const tone of tones) {
    const ratio = contrast(toneBackground(tone), toneForeground(tone));
    assert.ok(
      ratio >= 3,
      `tone-${tone} is ${ratio.toFixed(2)}:1 on its tint — below the 3:1 floor for a glyph`,
    );
  }
});

test("no kind tone collides with the live theme's primary accent", () => {
  // Every layout in the app hardcodes data-ds-theme="emerald", so this is
  // the accent a photographer actually sees. A kind tile within 30° of it
  // reads as a primary action — which is what mint did at one degree.
  const primary = /\.ds-root\[data-ds-theme="emerald"\][^}]*--ds-claret:\s*(#[0-9a-f]{6})/i
    .exec(designSystem);
  assert.ok(primary, "the emerald theme no longer defines --ds-claret");

  for (const tone of tones) {
    const distance = hueDistance(primary[1], toneForeground(tone));
    assert.ok(
      distance >= 30,
      `tone-${tone} is ${distance.toFixed(0)}° from the primary accent — it will read as a primary action`,
    );
  }
});

test("the preview-only themes are on record as unsafe for kind tones", () => {
  // ivory, rose and coral all put at least one kind tone within 30° of
  // their primary — coral puts three there. They are reachable only from
  // /studio-preview today, so this is a documented constraint rather than
  // a bug: making one of them selectable means rotating the colliding
  // tones for that theme first. This test fails if that stops being true,
  // which is the moment the note would otherwise go stale.
  const unsafe = ["ivory", "rose", "coral"].filter((theme) => {
    const accent = new RegExp(
      `\\.ds-root\\[data-ds-theme="${theme}"\\][^}]*--ds-claret:\\s*(#[0-9a-f]{6})`,
      "i",
    ).exec(designSystem);
    if (!accent) return false;
    return tones.some((tone) => hueDistance(accent[1], toneForeground(tone)) < 30);
  });
  assert.deepEqual(unsafe, ["ivory", "rose", "coral"]);

  const shell = readFileSync("components/layout/app-shell.tsx", "utf8");
  assert.match(
    shell,
    /data-ds-theme="emerald"/,
    "the app shell no longer pins emerald — the tones above need per-theme overrides",
  );
});
