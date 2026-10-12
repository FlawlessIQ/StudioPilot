import { tradeOf, tradeProfile, tradeVocab } from "../trades/trades.js";
import { resolveTenantBrand } from "../branding/tenant-brand.js";
import { consultationPurpose } from "./consultation-purpose.js";

/**
 * What a client's scheduling link answers when it is opened: the studio's
 * openings while it can still book, the time they booked once they have, and
 * "expired" for everything else.
 *
 * Every link that was not pending read as expired. A client who had booked
 * and opened the link again was told "This scheduling link has expired.
 * Reply to the studio's email and they'll send a new one", under "Your
 * studio", about a hair trial booked for Wed, Oct 14 at 10:00 AM (Priya Shah,
 * Jess Styles Bridal, 2026-10-11). A photographer's consultation link did the
 * same.
 *
 * Booked means the call the link booked is still on and still ahead:
 * scheduled (not cancelled, held, a no-show or filed away), not yet over, on
 * a job the studio has not called off or put away. A studio's move keeps the
 * call's id (rescheduleConsultation), so it is read as it stands. A call the
 * client moved from their inquiry page is a new record, and the old one points
 * to it (`supersededBy`), so that is followed.
 *
 * The link's `expiresAt` is when it stops taking bookings. A call booked
 * before then can fall after it, so a booked link answers by its call, not by
 * its expiry.
 *
 * Only a pending link books ("open"). A booked one never passes that check,
 * so booking twice through one link stays refused (public-scheduling.ts
 * `activeLink`). Two bookings sent at the same moment both pass it, so the
 * booking also writes the link only as it was read (`linkChangedSinceRead`):
 * the second is refused as a booked link is. The page shows the time and no
 * picker. This link has never moved a call, so to change it the client replies
 * to the studio's email, as their confirmation tells them.
 *
 * The token is the only credential. A booked link shows what its pending page
 * showed, plus when. An unknown token shows nothing.
 *
 * Pure: tests/booked-scheduling-link.test.ts.
 */

type Row = Record<string, unknown>;

export type SchedulingLinkState = "open" | "booked" | "expired";

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** A studio with no name yet, named by what it does. */
export function studioFallback(trade: unknown): string {
  return tradeProfile(trade).family === "photo" ? "Your photography studio" : "Your studio";
}

/**
 * Whether the link can still book: pending, and not past its expiry. This is
 * the check the link has always had to pass to show openings or book one.
 */
export function linkIsOpen(link: Row | null | undefined, nowMs: number): boolean {
  if (!link || link.status !== "pending") return false;
  // As it always read: only an expiry at or before now closes it.
  return !(Date.parse(String(link.expiresAt)) <= nowMs);
}

/** Where a call went when the client moved it from their inquiry page, or null. */
export function movedTo(call: Row): string | null {
  return call.status === "rescheduled" ? text(call.supersededBy) || null : null;
}

/** How many moves are followed from the call a link booked. More than this is not a chain anyone made. */
export const MAX_MOVES_FOLLOWED = 5;

/**
 * The call a booked link booked, as it is now, followed through any moves the
 * client made. Null when there is none, or when any step leaves the link's
 * studio and job.
 */
export async function callBookedBy(
  link: Row,
  load: (consultationId: string) => Promise<Row | null>,
): Promise<Row | null> {
  let id = text(link.bookedConsultationId);
  for (let moves = 0; moves <= MAX_MOVES_FOLLOWED; moves += 1) {
    // Ids are the server's own, but a path is never built from one with a slash.
    if (!id || id.includes("/")) return null;
    const call = await load(id);
    if (!call) return null;
    if (call.tenantId !== link.tenantId || call.projectId !== link.projectId) return null;
    const next = movedTo(call);
    if (!next) return call;
    id = next;
  }
  return null;
}

/** The studio called the job off or put it away. A call on it is not one to show as booked. */
function jobStopped(project: Row): boolean {
  const state = text(project.state);
  return state === "CANCELLED" || state === "LOST" || state === "ARCHIVED" || Boolean(project.archivedAt);
}

export function schedulingLinkState(input: {
  /** The link the token named, or null for an unknown token. */
  link: Row | null | undefined;
  /** The call it booked, as it is now (callBookedBy), or null. */
  call: Row | null | undefined;
  project: Row | null | undefined;
  nowMs: number;
}): SchedulingLinkState {
  const { link, call, project } = input;
  if (!link) return "expired";
  if (linkIsOpen(link, input.nowMs)) return "open";
  // Pending and past its expiry, withdrawn, or replaced: as before.
  if (link.status !== "booked" || !text(link.bookedConsultationId)) return "expired";
  if (!call || !project) return "expired";
  if (call.tenantId !== link.tenantId || call.projectId !== link.projectId) return "expired";
  if (call.status !== "scheduled" || call.archivedAt) return "expired";
  // Still ahead, or under way (features/consultations/upcoming.ts).
  const ends = Date.parse(text(call.endsAt) || text(call.startsAt));
  if (!Number.isFinite(ends) || ends < input.nowMs) return "expired";
  if (jobStopped(project)) return "expired";
  return "booked";
}

/**
 * What the page is told about an open or booked link. The same fields either
 * way, plus the booked time on a booked link, in the studio's zone: the one
 * the openings were shown in.
 */
export function schedulingLinkPreview(input: {
  link: Row;
  tenant: Row;
  project: Row;
  /** The call a booked link booked; null or absent for an open link. */
  booked?: Row | null;
}): Record<string, unknown> {
  const { link, tenant, project, booked } = input;
  const brand = resolveTenantBrand(tenant, studioFallback(tenant.trade));
  const purpose = consultationPurpose(link);
  const words = tradeVocab(tenant.trade);
  return {
    studioName: brand.brandName,
    // The page names the call and the offer in the studio's words.
    trade: tradeOf(tenant.trade),
    // The couple sees the studio's brand (mobile-first plan, M2).
    brandAccentColor: brand.primaryColor,
    brandLogoUrl: brand.logoUrl,
    projectName: String(project.name ?? "Your project"),
    eventDate: project.eventDate ?? null,
    expiresAt: link.expiresAt,
    mode: link.mode,
    // The page says "final details call" for one (consultation-purpose.ts),
    // and a makeup or hair studio's trial by its own name (trades.ts).
    purpose,
    callName:
      purpose === "trial"
        ? words.trial ?? "Trial"
        : purpose === "walkthrough"
          ? "Venue walkthrough"
          : purpose === "final_details"
            ? words.finalCall
            : words.consultation,
    status: booked ? "booked" : "pending",
    ...(booked
      ? {
          booked: {
            startsAt: text(booked.startsAt),
            timezone: String(tenant.timezone ?? "America/New_York"),
          },
        }
      : {}),
  };
}

/** The reads the page's first answer needs. Each is null when there is no such record. */
export type SchedulingLinkReads = {
  /** The link the token names, whatever its state. */
  link: () => Promise<Row | null>;
  tenant: (tenantId: string) => Promise<Row | null>;
  project: (projectId: string) => Promise<Row | null>;
  consultation: (consultationId: string) => Promise<Row | null>;
};

/**
 * The page's first answer: the link's page while it can book, the booking
 * once it has, and SCHEDULING_LINK_EXPIRED for everything else. An unknown
 * token is refused before the studio, the job or a call is read.
 */
export async function previewSchedulingLink(read: SchedulingLinkReads, nowMs: number): Promise<Record<string, unknown>> {
  const link = await read.link();
  if (!link) throw new Error("SCHEDULING_LINK_EXPIRED");
  const [tenant, project, call] = await Promise.all([
    read.tenant(String(link.tenantId)),
    read.project(String(link.projectId)),
    link.status === "booked" ? callBookedBy(link, read.consultation) : Promise.resolve(null),
  ]);
  if (!tenant || !project) throw new Error("SCHEDULING_LINK_EXPIRED");
  const state = schedulingLinkState({ link, call, project, nowMs });
  if (state === "expired") throw new Error("SCHEDULING_LINK_EXPIRED");
  return schedulingLinkPreview({ link, tenant, project, booked: state === "booked" ? call : null });
}

/** Firestore's answer when a write's `lastUpdateTime` no longer matches the document. */
const FAILED_PRECONDITION = 9;

/**
 * The booking's commit was refused because the link changed after it was
 * read: another booking through it got there first, or the studio sent a new
 * link in its place. Either way the link no longer books.
 */
export function linkChangedSinceRead(caught: unknown): boolean {
  return (caught as { code?: unknown } | null | undefined)?.code === FAILED_PRECONDITION;
}
