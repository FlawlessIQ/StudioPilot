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
