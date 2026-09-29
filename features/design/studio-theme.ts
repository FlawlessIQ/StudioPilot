import tokens from "@/design/tokens.json";

/**
 * A studio's colour, made safe to build a screen from.
 *
 * Couples see the studio's brand, not StudioCue's (decided 2026-09-28,
 * docs/mobile-first-client-crew-plan-2026-09-28.md). A studio can pick any
 * colour, and many brand colours are too pale for white text on a button or
 * for a link on ivory. Rather than refuse the colour, it is darkened in small
 * steps, keeping its hue, until both read at WCAG AA (4.5:1). A colour that
 * already passes is used exactly as given.
 *
 * Pure: the same input gives the same theme on the web and, later, in a
 * native app.
 */

export type StudioTheme = {
  /** Buttons, progress, links, selected states. */
  accent: string;
  /** Pressed / emphasised accent. */
  accentStrong: string;
  /** Tinted panels behind accent text. */
  accentSoft: string;
  /** Borders on accent-soft panels. */
  accentLine: string;
  /** Text on an accent fill. */
  onAccent: string;
  /** Whether the studio's colour had to be darkened to be readable. */
  adjusted: boolean;
};

export const MIN_CONTRAST = 4.5;

const DEFAULT_ACCENT = tokens.color["accent-default"];
const PAPER = tokens.color.paper;
const IVORY = tokens.color.ivory;

type Rgb = [number, number, number];

export function parseHex(value: string | null | undefined): Rgb | null {
  if (typeof value !== "string") return null;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex =
    match[1]!.length === 3
      ? match[1]!.split("").map((digit) => digit + digit).join("")
      : match[1]!;
  const n = Number.parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function luminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(a: string, b: string): number {
  const first = parseHex(a);
  const second = parseHex(b);
  if (!first || !second) return 1;
  const [light, dark] = [luminance(first), luminance(second)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

function mix(color: Rgb, toward: Rgb, amount: number): Rgb {
  return color.map((channel, index) => channel + (toward[index]! - channel) * amount) as Rgb;
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

/** Readable as a fill under white text, and as text on paper and ivory. */
function readable(hex: string): boolean {
  return (
    contrastRatio(hex, "#FFFFFF") >= MIN_CONTRAST &&
    contrastRatio(hex, PAPER) >= MIN_CONTRAST &&
    contrastRatio(hex, IVORY) >= MIN_CONTRAST
  );
}

export function studioTheme(primary?: string | null): StudioTheme {
  const given = parseHex(primary) ?? parseHex(DEFAULT_ACCENT)!;
  let accent = toHex(given);
  let adjusted = false;
  // Darken toward black in 4% steps; 25 steps reaches black, which passes.
  for (let step = 1; step <= 25 && !readable(accent); step += 1) {
    accent = toHex(mix(given, BLACK, step * 0.04));
    adjusted = true;
  }
  const base = parseHex(accent)!;
  return {
    accent,
    accentStrong: toHex(mix(base, BLACK, 0.18)),
    accentSoft: toHex(mix(base, WHITE, 0.88)),
    accentLine: toHex(mix(base, WHITE, 0.7)),
    onAccent: "#FFFFFF",
    adjusted,
  };
}

/** The theme as the CSS custom properties the kit reads. */
export function studioThemeStyle(primary?: string | null): Record<string, string> {
  const theme = studioTheme(primary);
  return {
    "--kit-accent": theme.accent,
    "--kit-accent-strong": theme.accentStrong,
    "--kit-accent-soft": theme.accentSoft,
    "--kit-accent-line": theme.accentLine,
    "--kit-on-accent": theme.onAccent,
  };
}
