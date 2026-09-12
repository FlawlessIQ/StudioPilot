import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";
import type { ScheduleItem } from "@/features/schedules/schema";

/**
 * Sharing a published run of show with an external wedding vendor.
 *
 * This is deliberately *not* the crew model. A DJ or a hairdresser is a peer on
 * the wedding, not a subcontractor the studio hires and pays: no offer, no
 * cascade, no pay, no seat. They get one thing — a read-only link to the parts
 * of the run of show that concern them — and a way to say "seen, works for me".
 *
 * The link is the whole credential (the vendor has no account). The document is
 * keyed deterministically per (tenant, project, vendor) so re-sharing a newer
 * version reuses the same link rather than littering a vendor with dead ones,
 * and the raw token is never stored — only its hash — so a leaked database row
 * cannot reconstruct a working link.
 *
 * No crypto lives in this module: it is imported by both the browser (to draft
 * the message the operator approves) and server code, so it must stay
 * framework-neutral. Token minting and hashing live server-side
 * (`functions/src/planning/share-mint.ts` and the public route handlers).
 */

export const scheduleShareStatusSchema = z.enum([
  "sent",
  "viewed",
  "acknowledged",
  "revoked",
]);
export type ScheduleShareStatus = z.infer<typeof scheduleShareStatusSchema>;

/**
 * `vendor` shares only the segments that concern this vendor (the ones tagged to
 * them, plus anything explicitly marked shareable). `full` shares the whole
 * timeline minus studio-only rows — for a planner or videographer who needs the
 * complete picture.
 */
export const scheduleShareScopeSchema = z.enum(["vendor", "full"]);
export type ScheduleShareScope = z.infer<typeof scheduleShareScopeSchema>;

export const scheduleShareSchema = auditFieldsSchema.extend({
  id: z.string(),
  tenantId: z.string(),
  projectId: z.string(),
  /** The specific published schedule version this link resolves to. */
  scheduleId: z.string(),
  sharedVersion: z.number().int().positive(),
  vendorContactId: z.string(),
  vendorCompany: z.string(),
  vendorType: z.string(),
  scope: scheduleShareScopeSchema,
  message: z.string(),
  /** sha256 of the link token. The token itself is never persisted. */
  tokenHash: z.string(),
  status: scheduleShareStatusSchema,
  sentAt: z.string().datetime(),
  viewedAt: z.string().datetime().nullable(),
  viewedVersion: z.number().int().positive().nullable(),
  acknowledgedAt: z.string().datetime().nullable(),
  acknowledgedVersion: z.number().int().positive().nullable(),
  revokedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime(),
  sendCount: z.number().int().nonnegative(),
});
export type ScheduleShare = z.infer<typeof scheduleShareSchema>;

/** The public path a vendor opens. The token is the credential. */
export const shareLinkPath = (token: string) => `/share/${token}`;

/**
 * The segments an external vendor is allowed to see.
 *
 * A studio-only row is never shared, whatever the scope — it is where the
 * photographer keeps notes not meant for anyone else. `full` returns everything
 * else; `vendor` narrows to the rows tagged to this vendor plus anything the
 * studio explicitly marked shareable.
 */
export function vendorVisibleItems(
  items: readonly ScheduleItem[],
  vendorContactId: string,
  scope: ScheduleShareScope,
): ScheduleItem[] {
  const shareable = items.filter((item) => item.visibility !== "studio");
  if (scope === "full") return shareable.slice();
  return shareable.filter(
    (item) =>
      item.vendorContactIds.includes(vendorContactId) ||
      item.visibility === "shared",
  );
}

/**
 * A share is stale when the studio has published a newer run of show than the
 * one the link points at — the exact "someone's working off the old version"
 * failure this feature exists to kill.
 */
export function shareStale(
  share: Pick<ScheduleShare, "sharedVersion">,
  latestPublishedVersion: number,
): boolean {
  return latestPublishedVersion > share.sharedVersion;
}

const VENDOR_TYPE_FOCUS: Record<string, string> = {
  dj: "Your part is the reception flow — grand entrance, first dance, speeches, cake and last song.",
  band: "Your part is the reception flow — grand entrance, first dance, speeches and your sets.",
  hair_makeup:
    "The getting-ready window is highlighted — please confirm your arrival time and how long you need per person.",
  florist:
    "Setup and delivery windows are highlighted — please confirm your load-in and access time.",
  caterer:
    "Service and reception timings are highlighted — please confirm your setup and service windows.",
  videographer:
    "The full run of show is here so our coverage lines up — flag anything you'd stage differently.",
  planner:
    "Here is our run of show to cross-check against the master timeline — flag any conflicts.",
  transportation:
    "Pickup and departure timings are highlighted — please confirm your schedule.",
  venue:
    "Access, ceremony and reception timings are highlighted — please confirm the venue is set for each.",
  band_dj: "Your part is the reception flow — please confirm the order works.",
};

/**
 * The first-draft note that goes to the vendor — prepared, never sent, for the
 * operator to edit and approve. Deterministic (no model call): the value is a
 * sensible starting point in the studio's hands, not an autonomous send.
 */
export function draftVendorShareMessage(ctx: {
  vendorType: string;
  vendorContactName: string;
  /** Optional — omitted when the studio drafts before a project is in hand. */
  coupleNames?: string;
  eventDate?: string;
  venue?: string | null;
}): string {
  const focus =
    VENDOR_TYPE_FOCUS[ctx.vendorType] ??
    "Please review the timeline and confirm it works on your end.";
  const greeting = ctx.vendorContactName.trim()
    ? `Hi ${ctx.vendorContactName.trim()},`
    : "Hi,";
  // The page itself shows the couple, date and venue, so the note names them
  // only when the studio has them — otherwise it stays generic rather than
  // reading "for the couple's wedding on the wedding day".
  const opener =
    ctx.coupleNames && ctx.eventDate
      ? `Here's the run of show for ${ctx.coupleNames}'s wedding on ${ctx.eventDate}${ctx.venue ? ` at ${ctx.venue}` : ""}.`
      : "Here's the run of show for the wedding.";
  return `${greeting}\n\n${opener} ${focus}\n\nIf anything needs to move, reply and let me know — otherwise please confirm at the bottom of the page. Thank you!`;
}
