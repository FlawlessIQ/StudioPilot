import screens from "./screens.json";

/**
 * The website's screenshots: real screens of Ella & Marcus's wedding, the
 * same story as the film (docs/marketing-visuals-plan-2026-10-03.md §3).
 * scripts/marketing/screens.ts takes them and writes screens.json — the alt
 * text and size live with the shot, so a page names a screen and gets the
 * rest. The files are served from public/marketing/ at 1× and 2×.
 */
export type ScreenName = keyof typeof screens;

export type MarketingScreen = {
  name: ScreenName;
  alt: string;
  phone: boolean;
  width: number;
  height: number;
  src: string;
  srcSet: string;
};

export function marketingScreen(name: ScreenName): MarketingScreen {
  const entry = screens[name];
  const src = `/marketing/${name}.webp`;
  return {
    name,
    alt: entry.alt,
    phone: entry.phone,
    width: entry.width,
    height: entry.height,
    src,
    srcSet: `${src} 1x, /marketing/${name}@2x.webp 2x`,
  };
}
