import { tradeProfile } from "../trades/trades.js";

/**
 * Timeline versions after a republish: vendor shares and the couple's answer.
 *
 * Pure, so the rules are tested directly (tests/wave1-planning.test.ts).
 */

/**
 * What a newly published version asks of the client.
 *
 * A photographer's couple approves the day's schedule: "client_pending" until
 * they answer. A DJ's, makeup artist's or hair stylist's client has nothing to
 * approve (trades.ts `journey.scheduleApproval`; simpler vendor journeys,
 * 2026-10-09): the studio's publish is the last step, and the client reads
 * it. "none" is the schedule schema's own word for that
 * (features/schedules/schema.ts), and every reader that asks the client
 * (their portal's Approve button, their next step, the studio's "record
 * their answer") waits only on "client_pending".
 *
 * The trade decides rather than `journeyFor`: a photographer's family session
 * has no run of show in its profile, so `journeyFor` reads false there too,
 * and a photographer's publish must not change.
 */
export function publishedApprovalState(trade: unknown): "client_pending" | "none" {
  return tradeProfile(trade).journey.scheduleApproval ? "client_pending" : "none";
}

type ShareLike = {
  id: string;
  status?: unknown;
  revokedAt?: unknown;
  scheduleId?: unknown;
  vendorContactId?: unknown;
};

/**
 * The vendor links still pointing at an older version of the timeline.
 *
 * A share pins the version it was made from (planning/commands.ts,
 * shareRunOfShow) so a vendor confirms what the studio last sent. That is
 * right, and it meant a republished timeline — the ceremony moved an hour —
 * never reached the planner or the venue: their link kept showing the old
 * one, and nothing told the studio.
 */
export function staleVendorShares<T extends ShareLike>(
  shares: readonly T[],
  currentScheduleId: string,
): T[] {
  return shares.filter(
    (share) =>
      String(share.status) !== "revoked" &&
      !share.revokedAt &&
      typeof share.scheduleId === "string" &&
      share.scheduleId !== currentScheduleId,
  );
}

/** The email that carries a vendor's new link. The studio's note leads. */
export function revisedTimelineEmail(input: {
  projectName: string;
  version: number;
  message: string;
  shareUrl: string;
}): { customSubject: string; customBody: string; actionLabel: string; actionUrl: string } {
  const note = input.message.trim();
  return {
    customSubject: `Updated timeline: ${input.projectName}`,
    customBody: [
      note ||
        `The timeline for ${input.projectName} has changed. This link shows the new version (version ${input.version}).`,
      "Your earlier link no longer opens — please use this one, and confirm it works for you.",
    ].join("\n\n"),
    actionLabel: "Open the updated timeline",
    actionUrl: input.shareUrl,
  };
}

/**
 * Whether the studio may record the couple's answer on this version.
 *
 * The couple answers in their portal; plenty answer on the phone instead, and
 * the studio had no way to say so. Only the version they are being asked about
 * can take an answer: a superseded one describes a day that is no longer
 * planned, and one already approved has its answer.
 */
export function assertStudioMayRecordAnswer(schedule: {
  status: unknown;
  approvalState: unknown;
}) {
  const status = String(schedule.status);
  if (status === "superseded" || status === "archived")
    throw new Error("SCHEDULE_SUPERSEDED");
  // Published for the client to read, not to approve (publishedApprovalState).
  if (String(schedule.approvalState) === "none") throw new Error("SCHEDULE_NOT_IN_REVIEW");
  if (String(schedule.approvalState) === "client_approved" || status === "approved")
    throw new Error("SCHEDULE_ALREADY_APPROVED");
  if (status !== "published" && status !== "client_review" && status !== "changes_requested")
    throw new Error("SCHEDULE_NOT_IN_REVIEW");
}
