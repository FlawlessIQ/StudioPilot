/**
 * Conversion funnel with drop-off.
 *
 * The Insights funnel rendered as a flat numbered row — "1 Inquiries 3,
 * 2 Consultations 3, 3 Proposals sent 3, 4 Contracts complete 1" — which
 * contains a real finding (two of three proposals never became contracts) and
 * never states it. This computes the step-to-step conversion so the largest
 * leak can be named rather than left for the reader to spot.
 *
 * Deliberately not a trend: with a handful of records and no historical
 * snapshots there is nothing to trend, and this page's own rule is that it
 * does not invent figures from record creation.
 */

export type FunnelStage = {
  label: string;
  value: number;
};

export type FunnelStep = FunnelStage & {
  /** Share of the first stage that reached this one, 0-100. Null for stage one. */
  shareOfStart: number | null;
  /**
   * Share of the previous stage that reached this one, 0-100. Null for stage
   * one, and null when this stage is larger than its predecessor — a rate over
   * 100% is not a conversion, and "300%" reads as a bug to anyone looking at it.
   */
  conversionFromPrevious: number | null;
  /** True when this stage holds more than the one before it. */
  exceedsPrevious: boolean;
  /** How many were lost between the previous stage and this one. */
  lostFromPrevious: number;
};

export type FunnelAnalysis = {
  steps: FunnelStep[];
  /**
   * The step with the largest absolute loss from its predecessor, when that
   * loss is material. Null when nothing meaningful is leaking.
   */
  biggestLeak: {
    fromLabel: string;
    toLabel: string;
    lost: number;
    conversion: number;
  } | null;
};

const pct = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part / whole) * 100) : null;

const capped = (value: number | null): number | null =>
  value === null ? null : Math.min(100, value);

export function analyseFunnel(stages: readonly FunnelStage[]): FunnelAnalysis {
  const start = stages[0]?.value ?? 0;
  const steps: FunnelStep[] = stages.map((stage, index) => {
    const previous = index > 0 ? stages[index - 1].value : null;
    const exceedsPrevious = previous !== null && stage.value > previous;
    return {
      ...stage,
      // Capped at 100 because this drives a bar width; a stage larger than the
      // first would otherwise overflow its track.
      shareOfStart:
        index === 0 ? null : capped(pct(stage.value, start)),
      exceedsPrevious,
      conversionFromPrevious:
        previous === null || exceedsPrevious ? null : pct(stage.value, previous),
      // A later stage can exceed an earlier one (projects booked outside the
      // funnel, for instance), so a negative loss is clamped to zero.
      lostFromPrevious:
        previous === null ? 0 : Math.max(0, previous - stage.value),
    };
  });

  let biggestLeak: FunnelAnalysis["biggestLeak"] = null;
  for (let index = 1; index < steps.length; index += 1) {
    const step = steps[index];
    if (step.lostFromPrevious <= 0) continue;
    if (biggestLeak && step.lostFromPrevious <= biggestLeak.lost) continue;
    biggestLeak = {
      fromLabel: steps[index - 1].label,
      toLabel: step.label,
      lost: step.lostFromPrevious,
      conversion: step.conversionFromPrevious ?? 0,
    };
  }
  return { steps, biggestLeak };
}

/**
 * The funnel's stages, counted as jobs that got at least that far.
 *
 * The stages were counted from unrelated piles: every inquiry ever (ignoring
 * the range), every consultation record (several per job), every completed
 * contract (amendments too). So the "funnel" rose mid-way — 8 inquiries, 12
 * consultations, 19 contracts — every bar was capped at full width, and the
 * "largest leak" was an artefact of the counting (UI audit, 2026-10-02).
 *
 * Now the population is the jobs in range that came in as inquiries (an
 * imported booking never went through the funnel), and each job counts at
 * every stage up to the furthest its records or its state prove it reached.
 * Monotonic by construction, so every bar is a true share of the first.
 *
 * Pure.
 */
const STATE_REACH: Record<string, number> = {
  LEAD: 0,
  CONSULTATION: 1,
  PROPOSAL: 1,
  CONTRACT_PENDING: 2,
  RETAINER_PENDING: 3,
  BOOKED: 4,
  PLANNING: 4,
  READY: 4,
  EVENT_COMPLETE: 4,
  POST_PRODUCTION: 4,
  DELIVERED: 4,
  REVIEW_REQUESTED: 4,
  CLOSED: 4,
};

const SENT_PROPOSAL = new Set(["sent", "viewed", "accepted", "declined", "expired"]);

export function jobFunnelStages(input: {
  projects: readonly Record<string, unknown>[];
  consultations: readonly Record<string, unknown>[];
  proposals: readonly Record<string, unknown>[];
  contracts: readonly Record<string, unknown>[];
}): FunnelStage[] {
  const ids = (records: readonly Record<string, unknown>[], keep: (record: Record<string, unknown>) => boolean) =>
    new Set(
      records
        .filter(keep)
        .map((record) => String(record.projectId ?? ""))
        .filter(Boolean),
    );
  const consulted = ids(input.consultations, (record) => String(record.status ?? "") !== "cancelled");
  const proposed = ids(input.proposals, (record) => SENT_PROPOSAL.has(String(record.status ?? "")));
  const signed = ids(input.contracts, (record) => record.status === "completed");
  const counts = [0, 0, 0, 0, 0];
  for (const project of input.projects) {
    if (typeof project.importedAt === "string" && project.importedAt) continue;
    const id = String(project.id ?? "");
    const fromState =
      STATE_REACH[String(project.state ?? "")] ??
      (typeof project.bookingCompletedAt === "string" && project.bookingCompletedAt ? 4 : 0);
    const furthest = Math.max(
      fromState,
      consulted.has(id) ? 1 : 0,
      proposed.has(id) ? 2 : 0,
      signed.has(id) ? 3 : 0,
    );
    for (let stage = 0; stage <= furthest; stage += 1) counts[stage] += 1;
  }
  return [
    { label: "Inquiries", value: counts[0] },
    { label: "Consultations", value: counts[1] },
    { label: "Proposals sent", value: counts[2] },
    { label: "Contracts signed", value: counts[3] },
    { label: "Booked", value: counts[4] },
  ];
}
