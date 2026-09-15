/**
 * How many times the studio had to act to get a wedding from inquiry to
 * delivered.
 *
 * Every other number on the reports page measures what StudioCue did. This
 * one measures what it still asks of the photographer, which is the number the
 * product is trying to push down: each approval, tick, send and edit is an
 * action. It is read from product events, counting only those a studio member
 * performed — the couple's actions, provider webhooks and the schedulers are
 * not the studio's work.
 *
 * Pure, no I/O.
 */

type EventRow = Record<string, unknown>;
type ProjectRow = Record<string, unknown> & { id: string };

const DELIVERED_OR_LATER = new Set(["DELIVERED", "REVIEW_REQUESTED", "CLOSED", "ARCHIVED"]);

/** A person at the studio, not a worker, webhook or the couple. */
export function isStudioAction(event: EventRow): boolean {
  const actorType = typeof event.actorType === "string" ? event.actorType : "user";
  if (actorType !== "user") return false;
  const actorId = typeof event.actorId === "string" ? event.actorId : "";
  if (!actorId) return false;
  // Services name themselves: "booking-orchestrator", "studio_policy:…",
  // "system_inbound_draft", "stripe".
  return !/[-:]/.test(actorId) && !/^system_/.test(actorId) && actorId !== "stripe";
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

export function actionsPerWedding(input: {
  projects: ProjectRow[];
  events: EventRow[];
}): {
  /** Median studio actions across delivered weddings, or null with none. */
  deliveredMedian: number | null;
  deliveredCount: number;
  /** The delivered wedding that took the most, for a "look at this one". */
  most: { projectId: string; name: string; actions: number } | null;
} {
  const counts = new Map<string, number>();
  for (const event of input.events) {
    const projectId = typeof event.projectId === "string" ? event.projectId : "";
    if (!projectId || !isStudioAction(event)) continue;
    counts.set(projectId, (counts.get(projectId) ?? 0) + 1);
  }
  const delivered = input.projects.filter((project) => DELIVERED_OR_LATER.has(String(project.state)));
  const perWedding = delivered.map((project) => ({
    projectId: project.id,
    name: typeof project.name === "string" ? project.name : "A wedding",
    actions: counts.get(project.id) ?? 0,
  }));
  const most = perWedding.reduce<(typeof perWedding)[number] | null>(
    (top, row) => (!top || row.actions > top.actions ? row : top),
    null,
  );
  return {
    deliveredMedian: median(perWedding.map((row) => row.actions)),
    deliveredCount: delivered.length,
    most: most && most.actions > 0 ? most : null,
  };
}
