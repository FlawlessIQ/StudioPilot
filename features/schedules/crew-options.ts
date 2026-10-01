import { coverageRoleForLabel } from "@/features/crew/staffing-plan";
import type { CoverageRole } from "@/features/packages/coverage";

/**
 * Who the run-of-show editor offers for a segment.
 *
 * Everyone booked on the job — accepted, on this project — whatever their
 * trade, each with the role they were booked as. Offers still out are not on
 * the day yet, and putting them on a segment would publish a name that may
 * never turn up. The id is the crew profile id, the one `crewIds` holds
 * (features/schedules/item-crew.ts).
 */
export type ScheduleCrewOption = {
  id: string;
  name: string;
  role: string;
  trade: CoverageRole;
};

type Row = Readonly<Record<string, unknown>> & { id: string };

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function scheduleCrewOptions(input: {
  projectId: string;
  assignments: readonly Row[];
  profiles: readonly Row[];
}): ScheduleCrewOption[] {
  const seen = new Set<string>();
  const options: ScheduleCrewOption[] = [];
  for (const assignment of input.assignments) {
    if (assignment.projectId !== input.projectId) continue;
    if (assignment.status !== "accepted") continue;
    const id = text(assignment.crewProfileId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const role = text(assignment.role) || "Crew";
    const profile = input.profiles.find((entry) => entry.id === id);
    options.push({
      id,
      name: text(profile?.name) || "Crew member",
      role,
      trade: coverageRoleForLabel(role),
    });
  }
  return options;
}
