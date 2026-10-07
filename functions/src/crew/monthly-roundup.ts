import { getFirestore, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { resolveEventZone } from "../communications/event-reminders-core.js";
import {
  CREW_ROUNDUP_EMAIL,
  orderRoundup,
  roundupEnabled,
  roundupEntry,
  roundupJobId,
  roundupMonthDue,
  type RoundupEntry,
} from "./monthly-roundup-core.js";

/**
 * Each crew member's monthly list of their upcoming jobs — the Firestore half.
 * The rules are in monthly-roundup-core.ts.
 *
 * Hourly, so "9 AM on the first" is 9 AM in each studio's own zone; outside
 * the first days of a month it reads nothing. Each email's id is its
 * idempotency key, so a rerun or a second instance sends nothing twice. The
 * list is built again as the email sends (crewRoundupPlanFor): a job called
 * off or released in between is not on it, and an empty list is not sent.
 */

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
const ACTOR = "crew-roundup-scheduler";
const PAGE = 300;

/** The jobs on a list, read as they are now. */
async function entriesFor(
  db: Firestore,
  input: { tenantId: string; assignments: DocumentSnapshot[]; tenantZone: unknown; now: Date },
  projects: Map<string, Promise<DocumentSnapshot>>,
): Promise<RoundupEntry[]> {
  const entries: RoundupEntry[] = [];
  for (const assignment of input.assignments) {
    const row = assignment.data() ?? {};
    if (text(row.tenantId) !== input.tenantId) continue;
    const projectId = text(row.projectId);
    if (!projectId) continue;
    if (!projects.has(projectId)) projects.set(projectId, db.doc(`projects/${projectId}`).get());
    const project = await projects.get(projectId)!;
    const data = project.exists ? (project.data() ?? null) : null;
    const entry = roundupEntry({
      assignmentId: assignment.id,
      assignment: row,
      project: data,
      tenantId: input.tenantId,
      // The wedding's own zone, else the studio's.
      zone: resolveEventZone(data?.timezone, input.tenantZone),
      now: input.now,
    });
    if (entry) entries.push(entry);
  }
  return orderRoundup(entries);
}

/**
 * One sweep at a chosen `now`. The scheduler passes the clock; a script can
 * pass any instant to see what would go then.
 */
export async function sweepCrewRoundups(db: Firestore, now: Date): Promise<Record<string, number>> {
  const tally: Record<string, number> = {};
  const count = (key: string) => (tally[key] = (tally[key] ?? 0) + 1);
  // Nothing is due outside the first days of a month, in any zone: from the
  // UTC 4th to the 27th, every studio is past its window or not yet in it.
  const utcDay = now.getUTCDate();
  if (utcDay > 4 && utcDay < 28) return { idle: 1 };

  // Every accepted assignment, grouped by studio and crew member.
  const byPerson = new Map<string, DocumentSnapshot[]>();
  let last: DocumentSnapshot | null = null;
  for (;;) {
    let query = db.collection("crewAssignments").where("status", "==", "accepted").orderBy("__name__").limit(PAGE);
    if (last) query = query.startAfter(last);
    const page = await query.get();
    for (const assignment of page.docs) {
      const tenantId = text(assignment.get("tenantId"));
      const crewProfileId = text(assignment.get("crewProfileId"));
      if (!tenantId || !crewProfileId || assignment.get("archivedAt")) continue;
      const key = `${tenantId}\u0000${crewProfileId}`;
      byPerson.set(key, [...(byPerson.get(key) ?? []), assignment]);
    }
    if (page.size < PAGE) break;
    last = page.docs[page.docs.length - 1] ?? null;
  }

  const tenants = new Map<string, Promise<DocumentSnapshot>>();
  const projects = new Map<string, Promise<DocumentSnapshot>>();
  for (const [key, assignments] of byPerson) {
    const [tenantId, crewProfileId] = key.split("\u0000") as [string, string];
    try {
      if (!tenants.has(tenantId)) tenants.set(tenantId, db.doc(`tenants/${tenantId}`).get());
      const tenant = await tenants.get(tenantId)!;
      if (!tenant.exists || tenant.get("deletedAt")) {
        count("tenant_missing");
        continue;
      }
      if (!roundupEnabled(tenant.data())) {
        count("switched_off");
        continue;
      }
      const studioZone = resolveEventZone(tenant.get("timezone"));
      const month = roundupMonthDue(now, studioZone);
      if (!month) {
        count("not_due");
        continue;
      }
      const reference = db.doc(`emailJobs/${roundupJobId(tenantId, crewProfileId, month)}`);
      if ((await reference.get()).exists) {
        count("already");
        continue;
      }
      const entries = await entriesFor(db, { tenantId, assignments, tenantZone: tenant.get("timezone"), now }, projects);
      if (!entries.length) {
        count("nothing_upcoming");
        continue;
      }
      const profile = await db.doc(`crewProfiles/${crewProfileId}`).get();
      const email = profile.exists && profile.get("tenantId") === tenantId ? text(profile.get("email")) : "";
      if (!email.includes("@") || profile.get("archivedAt")) {
        count("no_email");
        continue;
      }
      const at = now.toISOString();
      try {
        await reference.create({
          id: reference.id,
          tenantId,
          crewProfileId,
          month,
          type: CREW_ROUNDUP_EMAIL,
          recipient: email,
          // Always set: left empty, the sender would greet them by a couple's name.
          recipientName: text(profile.get("name")) || text(profile.get("displayName")) || email.split("@")[0],
          // Which assignments to read again as it sends.
          assignmentIds: entries.map((entry) => entry.assignmentId),
          jobs: entries,
          timezone: studioZone,
          actionUrl: `${appUrl()}/crew/jobs`,
          status: "queued",
          attempts: 0,
          maxAttempts: 5,
          createdAt: at,
          updatedAt: at,
          createdBy: ACTOR,
        });
        count("queued");
      } catch (caught) {
        // Another run got there first: that one is the list.
        if ((caught as { code?: unknown }).code === 6) {
          count("already");
          continue;
        }
        throw caught;
      }
    } catch (caught) {
      count("failed");
      console.error(
        JSON.stringify({
          severity: "ERROR",
          event: "crew_roundup.failed",
          tenantId,
          crewProfileId,
          reason: caught instanceof Error ? caught.message : String(caught),
        }),
      );
    }
  }
  return tally;
}

export const crewRoundupScheduler = onSchedule(
  { schedule: "every 1 hours", timeZone: "UTC", retryCount: 2 },
  async () => {
    const tally = await sweepCrewRoundups(getFirestore(), new Date());
    console.log(JSON.stringify({ severity: "INFO", event: "crew_roundup.swept", ...tally }));
  },
);

/**
 * At send time (operations/jobs.ts): the list as it stands now, or a hold
 * when nothing on it is still ahead of them.
 */
export async function crewRoundupPlanFor(
  db: Firestore,
  job: DocumentSnapshot,
): Promise<{ hold: string } | { values: Record<string, unknown> }> {
  const tenantId = text(job.get("tenantId"));
  const ids = Array.isArray(job.get("assignmentIds"))
    ? (job.get("assignmentIds") as unknown[]).map(text).filter(Boolean)
    : [];
  const [tenant, ...assignments] = await Promise.all([
    db.doc(`tenants/${tenantId}`).get(),
    ...ids.map((id) => db.doc(`crewAssignments/${id}`).get()),
  ]);
  if (!tenant?.exists || !roundupEnabled(tenant.data())) return { hold: "switched_off" };
  const entries = await entriesFor(
    db,
    {
      tenantId,
      assignments: assignments.filter((assignment) => assignment.exists),
      tenantZone: tenant.get("timezone"),
      now: new Date(),
    },
    new Map(),
  );
  if (!entries.length) return { hold: "nothing_upcoming" };
  return { values: { jobs: entries } };
}
