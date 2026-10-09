/**
 * Crew messages, as threads the studio answers.
 *
 * "Message the studio" on a crew member's job writes `crewMessages`
 * (functions/src/crew/commands.ts contactStudio). The studio could read them
 * only on that crew member's assignment page — Messages listed client
 * conversations alone, and Today never heard of them — so a crew member's
 * event-day message sat unread (GR, 2026-10-09). One thread per assignment:
 * that is what the crew member's sheet shows them too.
 */

type Row = Record<string, unknown> & { id: string };

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export type CrewThreadMessage = {
  id: string;
  fromCrew: boolean;
  message: string;
  subject: string;
  urgent: boolean;
  createdAt: string;
};

export type CrewThread = {
  assignmentId: string;
  projectId: string;
  projectName: string;
  crewName: string;
  role: string;
  messages: CrewThreadMessage[];
  last: CrewThreadMessage;
  /** The crew member wrote last: the studio owes an answer. */
  awaitingStudio: boolean;
  /** Something they marked as event-day is still unanswered. */
  urgent: boolean;
};

export function crewThreads(input: {
  crewMessages: readonly Row[] | null | undefined;
  crewAssignments?: readonly Row[] | null;
  crewProfiles?: readonly Row[] | null;
  projects?: readonly Row[] | null;
}): CrewThread[] {
  const assignments = new Map((input.crewAssignments ?? []).map((row) => [row.id, row]));
  const profiles = new Map((input.crewProfiles ?? []).map((row) => [row.id, row]));
  const projects = new Map((input.projects ?? []).map((row) => [row.id, row]));
  const byAssignment = new Map<string, Row[]>();
  for (const row of input.crewMessages ?? []) {
    const assignmentId = text(row.assignmentId);
    if (!assignmentId) continue;
    byAssignment.set(assignmentId, [...(byAssignment.get(assignmentId) ?? []), row]);
  }
  const threads: CrewThread[] = [];
  for (const [assignmentId, rows] of byAssignment) {
    const messages = rows
      .map((row) => ({
        id: row.id,
        fromCrew: row.direction !== "studio_to_crew",
        message: text(row.message),
        subject: text(row.subject),
        urgent: row.urgency === "event_day",
        createdAt: text(row.createdAt),
      }))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const last = messages[messages.length - 1];
    if (!last) continue;
    const assignment = assignments.get(assignmentId);
    const projectId = text(rows[0]?.projectId) || text(assignment?.projectId);
    const profile = profiles.get(text(assignment?.crewProfileId));
    // Unanswered: everything the crew sent after the studio last wrote.
    const lastStudio = messages.map((message) => message.fromCrew).lastIndexOf(false);
    const unanswered = messages.slice(lastStudio + 1);
    threads.push({
      assignmentId,
      projectId,
      projectName: text(projects.get(projectId)?.name) || text(assignment?.projectName) || "A job",
      crewName: text(profile?.name) || text(assignment?.crewName) || "Crew member",
      role: text(assignment?.role),
      messages,
      last,
      awaitingStudio: last.fromCrew,
      urgent: unanswered.some((message) => message.urgent),
    });
  }
  // Waiting on the studio first, then newest.
  return threads.sort(
    (left, right) =>
      Number(right.awaitingStudio) - Number(left.awaitingStudio) ||
      right.last.createdAt.localeCompare(left.last.createdAt),
  );
}
