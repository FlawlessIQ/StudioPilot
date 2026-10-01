/**
 * Withdrawing everyone still waiting on a job, so the job can go.
 *
 * Deleting or archiving a job is refused while somebody is still waiting on it
 * (job-stopped.ts) — and rightly, because a crew member with an accepted
 * assignment is holding a Saturday. But the refusal was a dead end. GR
 * Productions, 2026-10-01: "I tried to delete [the] job to restart and won't
 * let me … They say I have an offer out." The panel named nobody and offered
 * nothing to press; the only way through was to cancel a wedding that was not
 * cancelled, or to find and withdraw each person by hand.
 *
 * This is that by-hand withdrawal, done for every live assignment at once,
 * inside the same command that then deletes or archives the job. Each person
 * is treated exactly as withdrawAssignment (./commands.ts) treats one:
 *
 *  - **Never said yes** (draft, invited, viewed): the assignment is closed
 *    quietly. No email — the offer disappearing from their crew app is the
 *    whole message, the same rule a job cancellation follows.
 *  - **Accepted**: closed *and* emailed the "you've been released" notice
 *    with the calendar file that takes the day out of their diary, and their
 *    Google Calendar invite is taken back if one went.
 *
 * The released wording rather than the "this job has been called off" one,
 * because deleting a job is not the same as the wedding being off — the studio
 * this was built for was deleting a job to start it again.
 *
 * ## When the job is being deleted
 *
 * The purge sweeps every document carrying this `projectId` — which would
 * include the very email and calendar job queued here, before the worker ever
 * read them. So for a delete they carry no `projectId`: the email holds its
 * own recipient, job name and calendar file, and the calendar job holds the
 * event id it needs, because the assignment it would normally read is gone.
 */
import { FieldValue } from "firebase-admin/firestore";
import type {
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  QueryDocumentSnapshot,
  SetOptions,
  Transaction,
} from "firebase-admin/firestore";
import { assignmentIcs, assignmentPlace } from "./calendar-ics.js";
import { dispositionFor, isLiveAssignment } from "./job-stopped.js";

/** Who is still waiting, for a studio to read before it decides. */
export type WaitingCrew = {
  assignmentId: string;
  /** The crew member's name, or null when their directory entry is gone. */
  name: string | null;
  role: string;
  status: string;
};

export type JobCrewRead = {
  /** Every assignment on the job, live or not, tenant-checked. */
  all: QueryDocumentSnapshot[];
  live: QueryDocumentSnapshot[];
  profiles: Map<string, DocumentSnapshot>;
  calendarEvents: Map<string, DocumentSnapshot>;
  /** Cascades behind a live assignment that are still working their list. */
  activeCascadeIds: string[];
  memberships: Map<string, DocumentSnapshot>;
};

/** A transaction's reads; a plain read would let an acceptance slip between. */
type Reader = Pick<Transaction, "get">;

/**
 * Every read the withdrawal needs, before any write, as a transaction requires.
 *
 * Read inside the transaction that writes, so a crew member accepting at the
 * same moment cannot slip between the read and the withdrawal — the same
 * guarantee withdrawAssignment gives for one person.
 */
export async function readJobCrew(
  transaction: Reader,
  db: Firestore,
  tenantId: string,
  projectId: string,
): Promise<JobCrewRead> {
  const snapshot = await transaction.get(
    db
      .collection("crewAssignments")
      .where("tenantId", "==", tenantId)
      .where("projectId", "==", projectId),
  );
  const all = snapshot.docs.filter((item) => item.get("tenantId") === tenantId);
  const live = all.filter((item) => isLiveAssignment(item.get("status")));
  const profileIds = [
    ...new Set(live.map((item) => String(item.get("crewProfileId") ?? "")).filter(Boolean)),
  ];
  const cascadeIds = [
    ...new Set(live.map((item) => String(item.get("cascadeId") ?? "")).filter(Boolean)),
  ];
  const userIds = [
    ...new Set(live.map((item) => String(item.get("userId") ?? "")).filter(Boolean)),
  ];
  const [profiles, calendarEvents, cascades, memberships] = await Promise.all([
    Promise.all(profileIds.map((id) => transaction.get(db.doc(`crewProfiles/${id}`)))),
    Promise.all(live.map((item) => transaction.get(db.doc(`crewCalendarEvents/${item.id}`)))),
    Promise.all(cascadeIds.map((id) => transaction.get(db.doc(`crewCascades/${id}`)))),
    Promise.all(
      userIds.map((id) => transaction.get(db.doc(`memberships/${tenantId}_${id}`))),
    ),
  ]);
  return {
    all,
    live,
    profiles: new Map(
      profiles
        .filter((item) => item.exists && item.get("tenantId") === tenantId)
        .map((item) => [item.id, item]),
    ),
    calendarEvents: new Map(
      calendarEvents.filter((item) => item.exists).map((item) => [item.id, item]),
    ),
    activeCascadeIds: cascades
      .filter(
        (item) =>
          item.exists &&
          item.get("tenantId") === tenantId &&
          item.get("status") === "active",
      )
      .map((item) => item.id),
    memberships: new Map(
      userIds.flatMap((userId, index) => {
        const membership = memberships[index];
        return membership?.exists ? [[userId, membership] as const] : [];
      }),
    ),
  };
}

/** Who is waiting, named from the crew directory where it can be. */
export function waitingCrew(read: JobCrewRead): WaitingCrew[] {
  return read.live.map((item) => {
    const profile = read.profiles.get(String(item.get("crewProfileId") ?? ""));
    const name = String(profile?.get("name") ?? "").trim();
    return {
      assignmentId: item.id,
      name: name || null,
      role: String(item.get("role") ?? "").trim() || "Crew",
      status: String(item.get("status") ?? ""),
    };
  });
}

/** The two writes this needs, which a Transaction has. */
type Writer = {
  update(reference: DocumentReference, data: Record<string, unknown>): unknown;
  set(
    reference: DocumentReference,
    data: Record<string, unknown>,
    options: SetOptions,
  ): unknown;
};

export type JobCrewWithdrawal = {
  withdrawn: string[];
  /** Assignments whose crew member was emailed. */
  notified: string[];
};

/**
 * End every live assignment on the job. Writes only — call readJobCrew first,
 * in the same transaction.
 */
export function withdrawJobCrew(
  writer: Writer,
  db: Firestore,
  read: JobCrewRead,
  options: {
    tenantId: string;
    projectId: string;
    projectName: string;
    actorId: string;
    now: string;
    /** Recorded on each assignment and in the audit entry. Not emailed. */
    reason: string;
    /** The job is about to be purged: queue nothing the sweep would take. */
    jobDeleted: boolean;
  },
): JobCrewWithdrawal {
  const withdrawn: string[] = [];
  const notified: string[] = [];
  const projectName = options.projectName || "Crew assignment";
  // Only the purge path leaves a pointer back; it is deliberately not called
  // `projectId`, which is the one field the sweep matches on.
  const jobLink = options.jobDeleted
    ? { projectId: null, deletedProjectId: options.projectId }
    : { projectId: options.projectId };
  const withdrawnUsers = new Set<string>();

  for (const assignment of read.live) {
    const disposition = dispositionFor({
      reason: "cancelled",
      status: String(assignment.get("status") ?? ""),
    });
    if (disposition.action !== "withdraw") continue;
    const role = String(assignment.get("role") ?? "") || "Crew";
    const calendarSequence = Number(assignment.get("calendarSequence") ?? 0) + 1;
    writer.update(assignment.ref, {
      status: "cancelled",
      cancelledAt: options.now,
      cancelledReason: options.reason,
      cancelledBy: options.actorId,
      withdrawnByStudio: true,
      ...(disposition.notify ? { calendarSequence } : {}),
      updatedAt: options.now,
      updatedBy: options.actorId,
    });
    withdrawn.push(assignment.id);
    const userId = String(assignment.get("userId") ?? "");
    if (userId) withdrawnUsers.add(userId);

    const calendarEvent = read.calendarEvents.get(assignment.id);
    if (calendarEvent)
      writer.update(calendarEvent.ref, { status: "cancelled", updatedAt: options.now });

    if (!disposition.notify) continue;
    const profileId = String(assignment.get("crewProfileId") ?? "");
    const profile = read.profiles.get(profileId);
    const email = String(profile?.get("email") ?? "").trim();
    // No address, no mail — never fall through to the worker's client-contact
    // default, which would tell the couple.
    if (email.includes("@")) {
      const arrivalAt = String(assignment.get("arrivalAt") ?? "");
      const departureAt = String(assignment.get("departureAt") ?? "");
      const noticeId = `crew_withdrawn_${assignment.id}`;
      writer.set(
        db.doc(`emailJobs/${noticeId}`),
        {
          id: noticeId,
          tenantId: options.tenantId,
          ...jobLink,
          // Read by the worker before the job record, which may be gone.
          projectName,
          assignmentId: assignment.id,
          type: "crew_assignment_cancelled",
          // "You've been released", not "the event is off".
          cause: "withdrawn",
          recipient: email,
          recipientName: profile?.get("name") ?? null,
          crewProfileId: profileId || null,
          role,
          reason: null,
          calendarAttachment:
            Number.isFinite(Date.parse(arrivalAt)) && Number.isFinite(Date.parse(departureAt))
              ? {
                  filename: "studiocue-assignment.ics",
                  content: assignmentIcs({
                    assignmentId: assignment.id,
                    startsAt: arrivalAt,
                    endsAt: departureAt,
                    projectName,
                    role,
                    location: assignmentPlace(assignment.get("locations")),
                    sequence: calendarSequence,
                    stampedAt: options.now,
                    cancelled: true,
                  }),
                }
              : null,
          status: "queued",
          attempts: 0,
          createdAt: options.now,
          updatedAt: options.now,
        },
        { merge: false },
      );
      notified.push(assignment.id);
    }
    const calendarEventId = String(assignment.get("calendarEventId") ?? "");
    if (calendarEventId) {
      const jobId = `crew_calendar_remove_${assignment.id}`;
      writer.set(
        db.doc(`providerJobs/${jobId}`),
        {
          id: jobId,
          tenantId: options.tenantId,
          ...jobLink,
          assignmentId: assignment.id,
          // The assignment is swept with the job; the worker reads this.
          calendarEventId,
          type: "remove_crew_calendar_invite",
          idempotencyKey: jobId,
          status: "queued",
          attempts: 0,
          createdAt: options.now,
          updatedAt: options.now,
        },
        { merge: true },
      );
    }
  }

  // A cascade still working down its list would offer the next name.
  for (const cascadeId of read.activeCascadeIds)
    writer.update(db.doc(`crewCascades/${cascadeId}`), {
      status: "exhausted",
      handlingCompletedAt: options.now,
      updatedAt: options.now,
      updatedBy: options.actorId,
    });

  /**
   * Close the job to them, as withdrawAssignment does: acceptance added the
   * project to a subcontractor's membership so they could read the day sheet.
   * Kept where they also have finished work on this job — unless the job is
   * being deleted, when there is nothing left to read.
   */
  for (const userId of withdrawnUsers) {
    const membership = read.memberships.get(userId);
    if (!membership || membership.get("role") !== "subcontractor") continue;
    const stillOnJob =
      !options.jobDeleted &&
      read.all.some(
        (item) =>
          !withdrawn.includes(item.id) &&
          String(item.get("userId") ?? "") === userId &&
          (isLiveAssignment(item.get("status")) || item.get("status") === "completed"),
      );
    if (stillOnJob) continue;
    writer.update(membership.ref, {
      projectIds: FieldValue.arrayRemove(options.projectId),
      updatedAt: options.now,
    });
  }

  return { withdrawn, notified };
}
