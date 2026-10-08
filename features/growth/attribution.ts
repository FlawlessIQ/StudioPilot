/**
 * Where a studio came from (docs/console.md, "Sources").
 *
 * Conor, 2026-10-07: the Console should say which channels and which referrals
 * bring studios in: Instagram, the website, a DJ's code. Two records answer
 * it, both written once at signup to `saasAttribution/{tenantId}`:
 *
 * - **The link.** The first page someone opened on studio-cue.com with
 *   anything to say about how they got there (campaign tags, an outside
 *   referring site, a referral or promo code), and the latest one. Kept in this
 *   browser only, and sent to us only if they go on to create a studio.
 * - **What they told us.** "How did you hear about StudioCue?" on the
 *   create-your-studio step.
 *
 * Browser-safe. The shape is mirrored by `attributionSchema` in
 * functions/src/saas/attribution-schema.ts, and a drift test checks the two.
 */

export const HEARD_OPTIONS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "google", label: "Google search" },
  { value: "youtube", label: "YouTube or a podcast" },
  { value: "photographer", label: "Another photographer" },
  { value: "vendor", label: "A DJ, planner, hair or makeup artist" },
  { value: "event", label: "A workshop or event" },
  { value: "other", label: "Somewhere else" },
] as const;

export type HeardValue = (typeof HEARD_OPTIONS)[number]["value"];

/** Answers that name someone, so the form asks who. */
export const HEARD_ASKS_WHO: Partial<Record<HeardValue, string>> = {
  photographer: "Who? (optional)",
  vendor: "Who? (optional)",
  event: "Which one? (optional)",
  other: "Where? (optional)",
};

export type Touch = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  /** The outside site that linked here, host only. */
  referrer: string | null;
  /** The path they landed on, without the query. */
  landing: string;
  /** `?code=` or `?ref=` on the link. */
  code: string | null;
  at: string;
};

export type Attribution = { first: Touch | null; last: Touch | null };

const KEY = "studiocue.attribution";
const OWN_HOSTS = /(^|\.)studio-cue\.com$|\.hosted\.app$|^localhost$|^127\.0\.0\.1$/;

function clean(value: string | null, max = 80): string | null {
  const trimmed = value?.trim().toLowerCase().slice(0, max);
  return trimmed ? trimmed : null;
}

/** What one page load says about how someone got here, or null when it says nothing. */
export function touchFrom(href: string, referrer: string, at: string): Touch | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const params = url.searchParams;
  let referrerHost: string | null = null;
  try {
    const host = referrer ? new URL(referrer).hostname.replace(/^www\./, "") : "";
    referrerHost = host && !OWN_HOSTS.test(host) ? host.slice(0, 120) : null;
  } catch {
    referrerHost = null;
  }
  const code = params.get("code") ?? params.get("ref");
  const touch: Touch = {
    source: clean(params.get("utm_source")),
    medium: clean(params.get("utm_medium")),
    campaign: clean(params.get("utm_campaign")),
    content: clean(params.get("utm_content")),
    referrer: referrerHost,
    landing: url.pathname.slice(0, 120) || "/",
    code: code && /^[A-Za-z0-9_-]{2,64}$/.test(code.trim()) ? code.trim().toUpperCase() : null,
    at,
  };
  return touch.source || touch.medium || touch.campaign || touch.referrer || touch.code ? touch : null;
}

function read(): Attribution {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Attribution | null;
    return parsed && typeof parsed === "object" ? { first: parsed.first ?? null, last: parsed.last ?? null } : { first: null, last: null };
  } catch {
    return { first: null, last: null };
  }
}

/**
 * Called on every page load. Keeps the first link that said anything and the
 * latest one. Nothing is kept for a browser sending Global Privacy Control.
 */
export function rememberTouch(): void {
  if (typeof window === "undefined") return;
  if ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return;
  const touch = touchFrom(window.location.href, document.referrer, new Date().toISOString());
  if (!touch) return;
  const current = read();
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ first: current.first ?? touch, last: touch }));
  } catch {
    // Blocked storage: the studio is simply unattributed.
  }
}

/** What to send with the new studio. */
export function rememberedAttribution(): Attribution {
  if (typeof window === "undefined") return { first: null, last: null };
  return read();
}
