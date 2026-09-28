"use client";

import { OutsideStepCard } from "@/components/outside-steps/outside-step-card";
import { useOutsideSteps } from "@/components/outside-steps/use-outside-steps";
import { OUTSIDE_STEP_IDS, outsideStepAvailable } from "@/features/outside-steps/registry";

/**
 * The outside steps a studio has started and not finished, in one place.
 *
 * Each step's card also lives beside the feature it unlocks; this is the list
 * of the ones in flight — applied and waiting, set up and not yet proven, or
 * flagged by the other company — so a studio sees everything it is waiting
 * on without visiting each page. Nothing started, nothing shown.
 */
export function OutsideStepsInFlight() {
  const { statuses } = useOutsideSteps();
  if (!statuses) return null;
  const inFlight = OUTSIDE_STEP_IDS.filter(
    (id) => outsideStepAvailable(id) && ["waiting", "attention"].includes(statuses[id].state),
  );
  if (!inFlight.length) return null;
  return (
    <section className="outside-steps-in-flight" aria-label="Waiting outside StudioCue">
      <p className="settings-group-label">Waiting outside StudioCue</p>
      <div>
        {inFlight.map((id) => (
          <OutsideStepCard key={id} status={statuses[id]} stepId={id} />
        ))}
      </div>
    </section>
  );
}
