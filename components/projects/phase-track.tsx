import {
  journeyPhaseLabel,
  journeyPhaseOrder,
} from "@/features/journey/phases";
import { projectPhase, projectPhaseIndex } from "@/features/projects/lifecycle";

/**
 * Five segments: how far through the arcs this job has come.
 *
 * Sits under the state chip in the Jobs table so a column of chips that all
 * read as "advancing" gains the one thing it was missing — position. Twelve
 * rows of these show the shape of a season at a glance: the cluster still
 * being sold, the cluster in preparation, the two being delivered.
 *
 * No hue. Progress is a state question and takes the state colours; the
 * kind palette is for what a thing *is*. A job that has left the lifecycle
 * — cancelled, archived — draws nothing rather than an empty track that
 * would read as "not started".
 */
export function PhaseTrack({ state }: { state: string }) {
  const phase = projectPhase(state);
  if (!phase) return null;
  const reached = projectPhaseIndex(state);
  return (
    <span
      className="phase-track"
      title={`${journeyPhaseLabel[phase]} · arc ${reached} of ${journeyPhaseOrder.length}`}
    >
      {journeyPhaseOrder.map((entry, index) => (
        <i
          className={
            index + 1 < reached
              ? "is-done"
              : index + 1 === reached
                ? "is-here"
                : undefined
          }
          key={entry}
        />
      ))}
      <span className="ds-sr-only">
        {journeyPhaseLabel[phase]} — arc {reached} of {journeyPhaseOrder.length}
      </span>
    </span>
  );
}
