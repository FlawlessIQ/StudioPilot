/**
 * What a studio may do, read from its subscription — one rule for the app
 * gate, every studio command, and every automated client send.
 *
 * Before this, "may this studio work" was `status is trialing or active`,
 * and every other status was a hard stop. A studio whose card failed at
 * trial end lost the whole product that minute, and its staff — who cannot
 * read the subscription — never saw why. The Terms (§ "Failed payments")
 * promise something gentler, and this is where that promise is kept:
 *
 * - **full** — trialing or active.
 * - **grace** — past due for less than {@link PAST_DUE_GRACE_DAYS} days.
 *   Everything still works; the app shows a banner.
 * - **read_only** — past due beyond grace, unpaid, paused, or cancelled
 *   within {@link CANCELLED_READ_ONLY_DAYS} days. The studio can open its
 *   jobs and export its data; it cannot send or change anything, and
 *   automated messages to its clients are held.
 * - **closed** — no subscription, checkout never finished, suspended, or
 *   cancelled longer ago than the read-only window.
 *
 * functions/src/saas/subscription-access.ts repeats everything below the
 * marker (functions/ cannot import features/); tests/subscription-access.test.ts
 * fails if the two drift.
 */
// ── mirrored below ──

export const PAST_DUE_GRACE_DAYS = 7;
export const CANCELLED_READ_ONLY_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SubscriptionAccessLevel = "full" | "grace" | "read_only" | "closed";

/** The subscription fields the rule reads. Anything else on the record is ignored. */
export type SubscriptionAccessRecord = {
  status?: unknown;
  suspendedAt?: unknown;
  pastDueSince?: unknown;
  lastPaymentFailedAt?: unknown;
  cancelledAt?: unknown;
  currentPeriodEnd?: unknown;
  trialEndAt?: unknown;
  updatedAt?: unknown;
};

export const SUBSCRIPTION_ACCESS_FIELDS = [
  "status",
  "suspendedAt",
  "pastDueSince",
  "lastPaymentFailedAt",
  "cancelledAt",
  "currentPeriodEnd",
  "trialEndAt",
  "updatedAt",
] as const;

export type SubscriptionAccess = {
  level: SubscriptionAccessLevel;
  /** The stored status, or "" when there is no subscription. */
  status: string;
  /** Past due: when full access ends and the studio becomes read-only. */
  graceEndsAt: string | null;
  /** Cancelled: when read-only access, and with it export, ends. */
  closesAt: string | null;
  /** Trialing: when the trial ends and the first charge is taken. */
  trialEndsAt: string | null;
};

function isoOrNull(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString();
}

export function subscriptionAccess(
  record: SubscriptionAccessRecord | null | undefined,
  now: number = Date.now(),
): SubscriptionAccess {
  const status = record ? String(record.status ?? "") : "";
  const base = { status, graceEndsAt: null, closesAt: null, trialEndsAt: null };
  if (!record || record.suspendedAt) return { ...base, level: "closed" };
  switch (status) {
    case "trialing":
      return {
        ...base,
        level: "full",
        trialEndsAt: isoOrNull(record.trialEndAt) ?? isoOrNull(record.currentPeriodEnd),
      };
    case "active":
      return { ...base, level: "full" };
    case "past_due": {
      // When the payment first failed. Records written before pastDueSince
      // existed fall back to the failure stamp, then to the last write.
      const since =
        isoOrNull(record.pastDueSince) ??
        isoOrNull(record.lastPaymentFailedAt) ??
        isoOrNull(record.updatedAt);
      if (!since) return { ...base, level: "read_only" };
      const graceEndsAt = addDays(since, PAST_DUE_GRACE_DAYS);
      return {
        ...base,
        level: now < Date.parse(graceEndsAt) ? "grace" : "read_only",
        graceEndsAt,
      };
    }
    case "unpaid":
    case "paused":
      return { ...base, level: "read_only" };
    case "cancelled":
    case "canceled": {
      const since = isoOrNull(record.cancelledAt) ?? isoOrNull(record.updatedAt);
      if (!since) return { ...base, level: "closed" };
      const closesAt = addDays(since, CANCELLED_READ_ONLY_DAYS);
      return {
        ...base,
        level: now < Date.parse(closesAt) ? "read_only" : "closed",
        closesAt,
      };
    }
    default:
      // incomplete (checkout never finished) and anything unrecognised.
      return { ...base, level: "closed" };
  }
}

/** The studio may change things and send: full access or within grace. */
export function accessAllowsWork(access: Pick<SubscriptionAccess, "level">): boolean {
  return access.level === "full" || access.level === "grace";
}

/** The studio may open its workspace at all (read-only included). */
export function accessAllowsViewing(access: Pick<SubscriptionAccess, "level">): boolean {
  return access.level !== "closed";
}
