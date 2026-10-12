/**
 * How much of the planning a wedding planner was booked for
 * (docs/planner-journey-plan.md, N4; decision 5).
 *
 * Full planning, partial planning and month-of coordination share the final
 * month, the day and the review. The tier decides only when the job's work
 * starts: a month-of couple hands over their vendors and details with the
 * Final details form eight weeks out, while a full or partial planner builds
 * the vendor team from the day the job books (and, in Phase 3, works a dated
 * planning checklist). So it is a field on the package (`planningScope`),
 * copied onto the package snapshot and the job when the package is chosen —
 * not three journeys.
 *
 * Only a trade whose profile says so (trades.ts `planningScope`) shows the
 * choice; every other job has none, and reads as before.
 *
 * Pure, no imports. Mirrored at functions/src/planning/planning-scope.ts;
 * tests/planner-journey.test.ts compares the two below the marker.
 */
// ── mirrored below ──

export const PLANNING_SCOPES = ["full", "partial", "coordination"] as const;
export type PlanningScope = (typeof PLANNING_SCOPES)[number];

export const PLANNING_SCOPE_LABELS: Record<PlanningScope, string> = {
  full: "Full planning",
  partial: "Partial planning",
  coordination: "Month-of coordination",
};

/** One line on what each tier covers, for the package form. */
export const PLANNING_SCOPE_HINTS: Record<PlanningScope, string> = {
  full: "Everything from booking: the vendor team starts the day they book.",
  partial: "The vendors they still need, from booking.",
  coordination: "The final weeks: their vendors and details come in with the Final details form, eight weeks out.",
};

export function isPlanningScope(value: unknown): value is PlanningScope {
  return typeof value === "string" && (PLANNING_SCOPES as readonly string[]).includes(value);
}

/** A job's tier, from the job itself; null for a job with none (every trade but a planner's, or a one-off package). */
export function planningScopeOf(project: unknown): PlanningScope | null {
  const value = project && typeof project === "object" ? (project as { planningScope?: unknown }).planningScope : null;
  return isPlanningScope(value) ? value : null;
}

/** A month-of couple's Final details go out eight weeks before, when the work starts. */
export const COORDINATION_FORM_DAYS_BEFORE = 56;

/**
 * The day a wedding's planning form goes out, given what the studio's
 * planning timeline says (`timelineOpensOn`). A month-of coordination job
 * goes eight weeks out whatever the timeline; any other job keeps the
 * timeline's day, so nothing changes for a job without a tier.
 */
export function scopedFormOpensOn(
  project: unknown,
  eventDate: string | null | undefined,
  timelineOpensOn: string | null,
): string | null {
  if (planningScopeOf(project) !== "coordination") return timelineOpensOn;
  const day = String(eventDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return timelineOpensOn;
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - COORDINATION_FORM_DAYS_BEFORE);
  return value.toISOString().slice(0, 10);
}

/**
 * When the vendor team is the work: from booking (full and partial, and a
 * job with no tier), or as the couple's intake with their Final details
 * (month-of coordination).
 */
export function vendorTeamStarts(project: unknown): "booking" | "intake" {
  return planningScopeOf(project) === "coordination" ? "intake" : "booking";
}

/**
 * Phase 3's hook: whether the dated planning checklist applies to this job
 * (full and partial planning). Nothing reads it yet.
 */
export function planningChecklistApplies(project: unknown): boolean {
  const scope = planningScopeOf(project);
  return scope === "full" || scope === "partial";
}
