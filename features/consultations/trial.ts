import { isLiveConsultation } from "@/features/consultations/live";
import { isTrial } from "@/features/consultations/purpose";
import { callWhen } from "@/features/consultations/upcoming";
import { tradeProfile } from "@/features/trades/trades";

/**
 * Where a job's makeup or hair trial stands, for its journey step
 * (docs/vendor-journeys-plan.md, 3.2).
 *
 * The studio sends the client a link from the job ("Invite them to book the
 * trial"); booking makes a `consultations` record with `purpose: "trial"`.
 * It can come before the agreement or after it — both happen — so nothing
 * waits on it, and nothing is held up by a bride who didn't want one.
 */
export type TrialState = {
  state: "not_booked" | "booked" | "held";
  startsAt: string | null;
};

type Row = Record<string, unknown>;

/** The job's trial that is on or happened, the latest first; null when there is none. */
export function currentTrial<T extends Row>(consultations: readonly T[]): T | null {
  return (
    consultations
      .filter((record) => isTrial(record) && isLiveConsultation(record))
      .sort((left, right) => String(right.startsAt ?? "").localeCompare(String(left.startsAt ?? "")))[0] ?? null
  );
}

export function trialState(input: {
  consultations: readonly Row[];
  /** ISO, for "has it happened". */
  now: string;
}): TrialState {
  const trial = currentTrial(input.consultations);
  if (!trial) return { state: "not_booked", startsAt: null };
  const startsAt = String(trial.startsAt ?? "") || null;
  const held = trial.status === "completed" || (startsAt !== null && startsAt <= input.now);
  return { state: held ? "held" : "booked", startsAt };
}

/**
 * When the trial is, "Wed, Oct 14 at 10:00 AM", on the job's clock (the
 * trial's own, the studio's, when the job has none). Null when none is
 * booked.
 *
 * The job's trial card went on saying "Invite them to book the hair trial"
 * after the client had booked it, and the journey's step showed no date, so
 * nobody on the job could see it was booked (Priya Shah, Jess Styles Bridal,
 * 2026-10-10). Both read it from here.
 */
export function trialWhen(input: { consultations: readonly Row[]; timeZone?: string | null }): string | null {
  const trial = currentTrial(input.consultations);
  if (!trial || typeof trial.startsAt !== "string" || !trial.startsAt) return null;
  return callWhen({ ...trial, timezone: input.timeZone || trial.timezone }) || null;
}

/** "trial" as a whole word: "Bridal hair trial", "Makeup trial", never "industrial". */
const TRIAL_WORD = /\btrials?\b/i;

const words = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (value: unknown): string | null => {
  const day = typeof value === "string" ? value.slice(0, 10) : "";
  return DAY.test(day) && !Number.isNaN(Date.parse(`${day}T12:00:00Z`)) ? day : null;
};

/**
 * Whether a day is left to hold a trial on before the event: tomorrow at the
 * earliest, the day before the event at the latest. Those are the days a
 * trial link offers (functions/src/booking/trial-window.ts `trialWindow`,
 * which is null exactly when this is false). A job with no date always has one.
 *
 * On a hair job dated today, the job's trial card still offered "Invite them
 * to book the hair trial", the journey listed the trial as a step still to
 * come, and the quote's extras suggested "Bridal hair trial · $150", though
 * the link would have had no day to offer (Priya Shah Sangeet, Jess Styles
 * Bridal, 2026-10-12).
 */
export function trialDayLeft(input: {
  /** YYYY-MM-DD on the studio's clock. */
  today: string;
  eventDate: unknown;
}): boolean {
  const today = dayOf(input.today);
  const eventDay = dayOf(input.eventDate);
  if (!today || !eventDay) return true;
  // Tomorrow is today + 1 and the last day is the event - 1: a day is left
  // when the event is two or more days away.
  return Math.round((Date.parse(`${eventDay}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000) >= 2;
}

/**
 * The trial already happened or is on the books, as the job itself records it:
 * booked through its link (public-scheduling.ts writes `trialBookedAt`), or
 * the look noted from it (`trialNotes`). Today reads it the same way
 * (features/today/inbox.ts).
 */
export function trialArrangedOnJob(project: Row | null | undefined): boolean {
  return Boolean(project && (words(project.trialBookedAt) || project.trialNotes));
}

/**
 * The package's own extras to suggest on a job's quote. A trial extra is not
 * suggested once no day is left to hold the trial before the event, unless
 * one was booked or held. Every other extra, and every trade without a trial
 * (a photographer, a DJ), is suggested as before. The library still lists it,
 * unmarked, for a studio that wants it anyway.
 */
export function extrasToSuggest<T extends Row>(
  rows: readonly T[],
  input: { trade: unknown; today: string; eventDate: unknown; trialArranged: boolean },
): T[] {
  if (!tradeProfile(input.trade).trial || input.trialArranged || trialDayLeft(input)) return [...rows];
  return rows.filter((row) => !TRIAL_WORD.test(words(row.name)));
}

/**
 * Why the client should be asked to book a trial: they bought one (a package,
 * add-on or included item on the job says "trial"), or they said yes to one
 * on their inquiry. Null when neither.
 *
 * Priya Shah paid for a "Bridal hair trial" add-on and answered "Would you
 * like a hair trial before the day?" with Yes, and once she booked nothing
 * prompted the studio to invite her to it (Jess Styles Bridal, 2026-10-10).
 * Today reads this (features/today/inbox.ts).
 */
export function trialWanted(input: {
  /** The job's booked package snapshots (features/crew/staffing-plan.ts `jobPackageSnapshotIds`). */
  snapshots: readonly Row[];
  /** The inquiries the job came from. */
  leads: readonly Row[];
}): { reason: "bought"; item: string } | { reason: "asked" } | null {
  for (const snapshot of input.snapshots) {
    const addOns = Array.isArray(snapshot.addOns) ? (snapshot.addOns as unknown[]) : [];
    for (const addOn of addOns) {
      const name = words((addOn as Row | null)?.name);
      if (TRIAL_WORD.test(name)) return { reason: "bought", item: name };
    }
    const deliverables = Array.isArray(snapshot.includedDeliverables) ? (snapshot.includedDeliverables as unknown[]) : [];
    const included = deliverables.map(words).find((name) => TRIAL_WORD.test(name));
    if (included) return { reason: "bought", item: included };
    const packageName = words(snapshot.packageName);
    if (TRIAL_WORD.test(packageName)) return { reason: "bought", item: packageName };
  }
  for (const lead of input.leads) {
    const answers = Array.isArray(lead.customAnswers) ? (lead.customAnswers as unknown[]) : [];
    // The beauty inquiry form's own question (features/leads/inquiry-form-config.ts).
    const said = answers.some((answer) => {
      const entry = (answer ?? {}) as Row;
      return entry.questionId === "trial-wanted" && /^yes$/i.test(words(entry.answer));
    });
    if (said) return { reason: "asked" };
  }
  return null;
}

/** How long a trial link stayed open before the job kept its own invite: a call's fourteen days. */
const EARLIER_TRIAL_LINK_DAYS = 14;

/**
 * The trial invite the client was last sent, and whether its link still
 * works. Null when none was sent.
 *
 * Read from the job itself: public-scheduling.ts `create_link` writes
 * `trialInvitedAt` and `trialInviteExpiresAt` on it. Today read the invite
 * from the studio's email jobs, a hundred of them in no order, so on a busy
 * studio a sent invite fell out of the sample, the card came back, and a
 * second send replaced the link the client already had (review of the hair
 * walk, Jess Styles Bridal, 2026-10-10). An email job still counts for an
 * invite sent before the job kept its own, with the fourteen-day link it had
 * then; it can only ever say an invite went, never that one didn't.
 */
export function trialInvite(input: {
  project: Row & { id: string };
  emailJobs: readonly Row[];
  /** ISO. */
  now: string;
}): { sentAt: string; open: boolean } | null {
  const now = Date.parse(input.now);
  const sentAt = words(input.project.trialInvitedAt);
  if (sentAt) {
    const closesAt = Date.parse(words(input.project.trialInviteExpiresAt));
    return { sentAt, open: Number.isFinite(closesAt) && closesAt > now };
  }
  const earlier =
    input.emailJobs
      .filter(
        (email) =>
          words(email.projectId) === input.project.id &&
          words(email.type) === "consultation_invitation" &&
          words(email.purpose) === "trial",
      )
      .map((email) => words(email.createdAt))
      .filter((createdAt) => Number.isFinite(Date.parse(createdAt)))
      .sort()
      .at(-1) ?? null;
  if (!earlier) return null;
  return { sentAt: earlier, open: Date.parse(earlier) + EARLIER_TRIAL_LINK_DAYS * 86_400_000 > now };
}
