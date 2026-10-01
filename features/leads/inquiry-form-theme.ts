import { contrastRatio, MIN_CONTRAST, parseHex, studioTheme, toHex } from "@/features/design/studio-theme";
import type { InquiryBackground, InquiryFormConfig } from "@/features/leads/inquiry-form-config";

/**
 * The inquiry form's colours: the studio's button colour (or its brand
 * colour) and the background it picked, as the kit's CSS variables, set on
 * the inquiry page's kit root only.
 *
 * Any colour a studio picks is used, but never at the cost of reading it: the
 * accent is darkened (keeping its hue) until it reads at WCAG AA as text on
 * the chosen background and on the cards, and the text on a button is
 * whichever of white or ink reads better on it.
 */

export const INQUIRY_BACKGROUND_SWATCHES: Record<
  InquiryBackground,
  { label: string; page: string; card: string; line: string; sunken: string }
> = {
  cream: { label: "Cream", page: "#F7F3EC", card: "#FFFDF9", line: "#E8E0D3", sunken: "#EDE6DA" },
  white: { label: "White", page: "#FFFFFF", card: "#FFFFFF", line: "#E4E4E7", sunken: "#F2F2F3" },
  light: { label: "Light grey", page: "#F3F5F7", card: "#FFFFFF", line: "#E1E5EA", sunken: "#E8ECF0" },
};

const INK = "#1D1A16";
const WHITE = "#FFFFFF";

/** White or ink, whichever reads better on `fill`. */
export function readableForeground(fill: string): string {
  return contrastRatio(fill, WHITE) >= contrastRatio(fill, INK) ? WHITE : INK;
}

/** `color` darkened in small steps until it reads on every surface given. */
export function readableOn(color: string, surfaces: readonly string[]): string {
  const start = parseHex(color);
  if (!start) return color;
  let current = toHex(start);
  for (let step = 1; step <= 25 && surfaces.some((surface) => contrastRatio(current, surface) < MIN_CONTRAST); step += 1) {
    current = toHex(start.map((channel) => channel * (1 - step * 0.04)) as [number, number, number]);
  }
  return current;
}

export function inquiryFormTheme(
  brandColor: string | null | undefined,
  appearance: Pick<InquiryFormConfig, "buttonColor" | "background">,
) {
  const swatch = INQUIRY_BACKGROUND_SWATCHES[appearance.background] ?? INQUIRY_BACKGROUND_SWATCHES.cream;
  const base = studioTheme(appearance.buttonColor ?? brandColor);
  const accent = readableOn(base.accent, [swatch.page, swatch.card]);
  const tones = studioTheme(accent);
  return {
    accent,
    accentStrong: tones.accentStrong,
    accentSoft: tones.accentSoft,
    accentLine: tones.accentLine,
    onAccent: readableForeground(accent),
    page: swatch.page,
    card: swatch.card,
    line: swatch.line,
    sunken: swatch.sunken,
  };
}

/** The same, as the kit's custom properties. */
export function inquiryFormThemeStyle(
  brandColor: string | null | undefined,
  appearance: Pick<InquiryFormConfig, "buttonColor" | "background">,
): Record<string, string> {
  const theme = inquiryFormTheme(brandColor, appearance);
  return {
    "--kit-accent": theme.accent,
    "--kit-accent-strong": theme.accentStrong,
    "--kit-accent-soft": theme.accentSoft,
    "--kit-accent-line": theme.accentLine,
    "--kit-on-accent": theme.onAccent,
    "--kit-ivory": theme.page,
    "--kit-paper": theme.card,
    "--kit-line": theme.line,
    "--kit-sunken": theme.sunken,
  };
}
