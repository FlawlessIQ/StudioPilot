import type { HeardValue, Touch } from "@/features/growth/attribution";
import type { ConsoleStudio } from "./model";

/**
 * Console → Sources (docs/console.md): which channels and partners bring
 * studios in, and which of those studios go on to pay.
 *
 * One channel per studio, chosen in this order:
 * 1. what an operator filed it under by hand;
 * 2. a partner's code (the referral the Stripe webhook recorded, or a code on
 *    the signup link that belongs to a partner);
 * 3. what the owner told us at signup ("How did you hear about StudioCue?");
 * 4. the link they arrived on (campaign tags, then the referring site);
 * 5. "Direct" when we were listening and heard nothing, "Before tracking"
 *    for studios created before 2026-10-07.
 *
 * What they said comes before the link because a link mostly records the last
 * click: someone told about StudioCue by another photographer often arrives by
 * searching for it. Both are kept, and the Sources page shows each.
 *
 * Pure. `SOURCE_CHANNELS` is mirrored in functions/src/saas/attribution-schema.ts.
 */

export const SOURCE_CHANNELS = [
  "partner",
  "vendor",
  "instagram",
  "facebook",
  "tiktok",
  "youtube",
  "search",
  "ads",
  "email",
  "photographer",
  "event",
  "website",
  "direct",
  "other",
] as const;

export type SourceChannel = (typeof SOURCE_CHANNELS)[number] | "unknown";

export const CHANNEL_LABELS: Record<SourceChannel, string> = {
  partner: "Partner code",
  vendor: "A vendor, no code",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube or podcast",
  search: "Search",
  ads: "Paid ads",
  email: "Email",
  photographer: "Another photographer",
  event: "Workshop or event",
  website: "Another website",
  direct: "Direct",
  other: "Other",
  unknown: "Before tracking",
};

export type SourceBasis = "manual" | "partner" | "told" | "link" | "none";

export const BASIS_LABELS: Record<SourceBasis, string> = {
  manual: "Filed by hand",
  partner: "Partner code",
  told: "They told us",
  link: "From the link",
  none: "Nothing recorded",
};

/** `saasAttribution/{tenantId}`, written at signup and by Console → studio → Source. */
export type AttributionRecord = {
  id: string;
  tenantId?: string;
  heard?: HeardValue | null;
  heardDetail?: string | null;
  first?: Touch | null;
  last?: Touch | null;
  promotionCode?: string | null;
  manual?: { channel: SourceChannel; detail?: string | null; by?: string | null; at?: string } | null;
  createdAt?: string;
};

export type PartnerRef = { id: string; name: string; kind: string; code: string };
export type ReferralRef = { tenantId: string; partnerId: string; paidAt?: string | null };

export type StudioSource = {
  channel: SourceChannel;
  basis: SourceBasis;
  /** A partner, a campaign, a site, a name: whatever narrows the channel. */
  detail: string | null;
  partnerId: string | null;
  partnerKind: string | null;
  /** The link, described on its own, whatever channel won. */
  linkChannel: SourceChannel | null;
  linkDetail: string | null;
  campaign: string | null;
  landing: string | null;
};

const HEARD_CHANNEL: Record<HeardValue, SourceChannel> = {
  instagram: "instagram",
  facebook: "facebook",
  tiktok: "tiktok",
  google: "search",
  youtube: "youtube",
  photographer: "photographer",
  vendor: "vendor",
  event: "event",
  other: "other",
};

const PAID = /^(cpc|ppc|paid|paid[_-]?social|paidsocial|ads?|display|sponsored)$/;
const SITE_CHANNEL: Array<[RegExp, SourceChannel]> = [
  [/(^|\.)(instagram\.com|ig\.me)$|^(ig|instagram)$/, "instagram"],
  [/(^|\.)(facebook\.com|fb\.me|fb\.com)$|^(fb|facebook|meta)$/, "facebook"],
  [/(^|\.)tiktok\.com$|^tiktok$/, "tiktok"],
  [/(^|\.)(youtube\.com|youtu\.be)$|^(youtube|yt|podcast)$/, "youtube"],
  [/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|ecosia\.org|search\.brave\.com)$|^(google|bing|duckduckgo)$/, "search"],
  [/^(email|newsletter|mailchimp|klaviyo)$|(^|\.)(mail\.google\.com|outlook\.live\.com)$/, "email"],
];

/** What a link alone says. */
export function channelOfTouch(touch: Touch | null | undefined): { channel: SourceChannel; detail: string | null } | null {
  if (!touch) return null;
  const source = touch.source ?? null;
  const medium = touch.medium ?? null;
  if (medium && PAID.test(medium)) return { channel: "ads", detail: source ?? touch.referrer };
  if (medium && /^(email|newsletter)$/.test(medium)) return { channel: "email", detail: touch.campaign ?? source };
  for (const candidate of [source, touch.referrer]) {
    if (!candidate) continue;
    const match = SITE_CHANNEL.find(([pattern]) => pattern.test(candidate));
    if (match) return { channel: match[1], detail: touch.campaign ?? null };
  }
  if (touch.referrer) return { channel: "website", detail: touch.referrer };
  if (source) return { channel: "other", detail: source };
  return null;
}

export function classifyStudio(input: {
  tenantId: string;
  attribution: AttributionRecord | null | undefined;
  referral: ReferralRef | null | undefined;
  partners: PartnerRef[];
}): StudioSource {
  const { attribution, referral, partners } = input;
  const link = channelOfTouch(attribution?.first) ?? channelOfTouch(attribution?.last);
  const campaign = attribution?.first?.campaign ?? attribution?.last?.campaign ?? null;
  const landing = attribution?.first?.landing ?? attribution?.last?.landing ?? null;
  const base = { linkChannel: link?.channel ?? null, linkDetail: link?.detail ?? null, campaign, landing };
  const codes = [attribution?.promotionCode, attribution?.first?.code, attribution?.last?.code].filter((code): code is string => Boolean(code));
  const partner =
    (referral ? partners.find((candidate) => candidate.id === referral.partnerId) : undefined) ??
    partners.find((candidate) => codes.includes(candidate.code));
  const partnerFields = { partnerId: partner?.id ?? referral?.partnerId ?? null, partnerKind: partner?.kind ?? null };

  if (attribution?.manual?.channel)
    return { channel: attribution.manual.channel, basis: "manual", detail: attribution.manual.detail ?? null, ...partnerFields, ...base };
  if (partner || referral)
    return { channel: "partner", basis: "partner", detail: partner?.name ?? null, ...partnerFields, ...base };
  if (attribution?.heard)
    return { channel: HEARD_CHANNEL[attribution.heard] ?? "other", basis: "told", detail: attribution.heardDetail ?? null, ...partnerFields, ...base };
  if (link) return { channel: link.channel, basis: "link", detail: link.detail, ...partnerFields, ...base };
  return { channel: attribution ? "direct" : "unknown", basis: "none", detail: codes[0] ? `Code ${codes[0]}` : null, ...partnerFields, ...base };
}

const PAYING = new Set(["active", "past_due", "unpaid", "paused"]);

/** How far a studio has come: signed up, added a card, paying. Comped studios are left out of every rate. */
export function funnelStage(studio: Pick<ConsoleStudio, "subscriptionStatus" | "comped">): "signed_up" | "card" | "paying" | "churned" {
  const status = studio.subscriptionStatus;
  if (status && PAYING.has(status)) return "paying";
  if (status === "cancelled") return "churned";
  if (status === "trialing") return "card";
  return "signed_up";
}

export type FunnelRow = {
  key: string;
  label: string;
  studios: number;
  /** Added a card: in a trial, paying, or paid once and left. */
  carded: number;
  paying: number;
  mrrCents: number;
};

/** One row per key, sorted by studios then paying. */
export function funnelBy<Item extends { studio: ConsoleStudio }>(
  items: Item[],
  keyOf: (item: Item) => { key: string; label: string } | null,
): FunnelRow[] {
  const rows = new Map<string, FunnelRow>();
  for (const item of items) {
    if (item.studio.comped) continue;
    const key = keyOf(item);
    if (!key) continue;
    const row = rows.get(key.key) ?? { key: key.key, label: key.label, studios: 0, carded: 0, paying: 0, mrrCents: 0 };
    const stage = funnelStage(item.studio);
    row.studios += 1;
    if (stage !== "signed_up") row.carded += 1;
    if (stage === "paying") {
      row.paying += 1;
      row.mrrCents += item.studio.mrrCents;
    }
    rows.set(key.key, row);
  }
  return [...rows.values()].sort((a, b) => b.studios - a.studios || b.paying - a.paying || a.label.localeCompare(b.label));
}

/** "40%", or "—" with nothing to divide by. */
export function rate(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}
