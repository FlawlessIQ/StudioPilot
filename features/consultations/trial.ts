import { isLiveConsultation } from "@/features/consultations/live";
import { isTrial } from "@/features/consultations/purpose";
import { callWhen } from "@/features/consultations/upcoming";

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
