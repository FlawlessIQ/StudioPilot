/**
 * Describing a failed provider step in terms of what did not happen.
 *
 * The production walk of 2026-08-26 found the studio's entire "Already late"
 * band was three cards reading, identically:
 *
 *   A provider step could not finish
 *   Smith Wedding · Create Dropbox Sign Request      waiting 2 days
 *   A provider step could not finish
 *   Smith Wedding · Create Dropbox Sign Request      waiting 1 day
 *   A provider step could not finish
 *   Smith Wedding · Create Quickbooks Invoice        waiting 1 day
 *
 * Three problems at once: the headline carried no information, the same step
 * appeared twice because each retry produced its own card, and the internal job
 * type was humanised (`create_dropbox_sign_request` → "Create Dropbox Sign
 * Request") but is still a workflow identifier rather than anything the
 * photographer asked for.
 *
 * So: name the outcome the studio cares about, and say which provider owns it.
 * Pure lookup, no I/O.
 */

export type ProviderFailure = {
  /** What did not happen, as the card's headline. */
  title: string;
  /** Which provider to go and look at. */
  provider: string | null;
};

const FAILURES: Record<string, ProviderFailure> = {
  create_docusign_envelope: {
    title: "The agreement didn't go out for signature",
    provider: "Docusign",
  },
  create_dropbox_sign_request: {
    title: "The agreement didn't go out for signature",
    provider: "Dropbox Sign",
  },
  create_quickbooks_invoice: {
    title: "The invoice wasn't created",
    provider: "QuickBooks",
  },
  reconcile_quickbooks_invoice: {
    title: "The payment status didn't update",
    provider: "QuickBooks",
  },
  create_stripe_invoice: {
    title: "The invoice wasn't created",
    provider: "Stripe",
  },
  create_consultation_resources: {
    title: "The consultation call wasn't booked",
    provider: "your calendar",
  },
  cancel_consultation_resources: {
    title: "The consultation wasn't cancelled",
    provider: "your calendar",
  },
  reschedule_consultation_resources: {
    title: "The consultation wasn't moved",
    provider: "your calendar",
  },
  capture_zoom_meeting_summary: {
    title: "The call summary didn't come back",
    provider: "Zoom",
  },
  upload_dropbox_document: {
    title: "A document didn't upload",
    provider: "Dropbox",
  },
  add_crew_calendar_invite: {
    title: "A crew calendar invite didn't send",
    provider: "your calendar",
  },
  complete_booking_side_effects: {
    title: "Part of the booking didn't finish",
    provider: null,
  },
  review_request: {
    title: "The review request didn't send",
    provider: "your email provider",
  },
  send_review_request: {
    title: "The review request didn't send",
    provider: "your email provider",
  },
};

/**
 * What to call a failed provider job.
 *
 * Falls back to a generic sentence rather than the raw type: an unmapped type is
 * a gap in this table, and printing `create_widget_thing` at a photographer is
 * worse than saying plainly that a step did not finish.
 */
export function describeProviderFailure(type: unknown): ProviderFailure {
  const key = typeof type === "string" ? type.trim().toLowerCase() : "";
  return (
    FAILURES[key] ?? {
      title: "A step with one of your connected tools didn't finish",
      provider: null,
    }
  );
}

/**
 * Collapse retries into one entry per project and step.
 *
 * Each attempt writes its own job row, so a step that has failed twice produced
 * two identical cards. The **oldest** attempt is kept as the representative —
 * that is how long the studio has actually been waiting — and the count of
 * attempts travels with it so the card can say it has happened more than once.
 */
export function groupProviderFailures<T extends Record<string, unknown>>(
  jobs: readonly T[],
): Array<{ job: T; attempts: number }> {
  const groups = new Map<string, { job: T; attempts: number }>();
  for (const job of jobs) {
    const key = `${String(job.projectId ?? "")}|${String(job.type ?? "")}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { job, attempts: 1 });
      continue;
    }
    existing.attempts += 1;
    // Keep whichever attempt is older, so "waiting N days" stays truthful.
    if (String(job.createdAt ?? "") < String(existing.job.createdAt ?? "")) {
      existing.job = job;
    }
  }
  return [...groups.values()];
}
