import type { SubscriptionAccess } from "./access";

/**
 * What the billing banner says for each subscription state
 * (components/saas/billing-banner.tsx renders it). Pure, so the copy for
 * every state is tested without rendering.
 */

/** How long before a trial ends the owner is reminded in the app. */
export const TRIAL_NOTICE_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export type BillingNotice = {
  tone: "warn" | "bad";
  title: string;
  body: string;
  /** Only the owner can fix billing; everyone else is told who can. */
  action: "manage" | "ask_owner" | null;
  /** A trial reminder may be dismissed for the day; billing trouble may not. */
  dismissible: boolean;
};

/** What the banner says, if anything. */
export function billingNotice(
  access: SubscriptionAccess | null | undefined,
  isOwner: boolean,
  now: number = Date.now(),
): BillingNotice | null {
  if (!access) return null;
  const fix = isOwner ? "manage" : "ask_owner";
  const who = isOwner ? "Update your card" : "Ask the studio owner to update the card";
  if (access.level === "grace") {
    return {
      tone: "warn",
      title: "Your last payment didn't go through",
      body: access.graceEndsAt
        ? `${who} by ${longDate(access.graceEndsAt)} to keep everything running. After that the studio becomes read-only and messages to clients are held.`
        : `${who} to keep everything running.`,
      action: fix,
      dismissible: false,
    };
  }
  if (access.level === "read_only") {
    if (access.status === "cancelled" || access.status === "canceled") {
      return {
        tone: "bad",
        title: "This studio's subscription has ended",
        body: access.closesAt
          ? `You can still open every job and export your data until ${longDate(access.closesAt)}. Nothing can be sent or changed${isOwner ? " — restart your plan to pick up where you left off" : ""}.`
          : "You can still open every job and export your data. Nothing can be sent or changed.",
        action: fix,
        dismissible: false,
      };
    }
    return {
      tone: "bad",
      title: "This studio is read-only until billing is updated",
      body: `You can open every job and export your data, but nothing can be sent or changed, and messages to clients are held until payment goes through. ${who} to reactivate.`,
      action: fix,
      dismissible: false,
    };
  }
  if (access.level === "full" && access.status === "trialing" && access.trialEndsAt && isOwner) {
    const remaining = Date.parse(access.trialEndsAt) - now;
    if (remaining > 0 && remaining <= TRIAL_NOTICE_DAYS * DAY_MS) {
      return {
        tone: "warn",
        title: `Your free trial ends ${longDate(access.trialEndsAt)}`,
        body: "Your plan renews automatically then, and your card is charged. Change your plan or cancel any time under Plan & billing.",
        action: "manage",
        dismissible: true,
      };
    }
  }
  return null;
}
