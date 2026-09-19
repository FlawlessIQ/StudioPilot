import { randomBytes } from "node:crypto";
import {
  getFirestore,
  type DocumentSnapshot,
  type Firestore,
} from "firebase-admin/firestore";
import { resolveCoverage } from "../packages/coverage.js";
import { planCrewStaffing } from "./staffing-plan.js";
import type { CrewCandidateInput } from "./cascade.js";
import { cascadeAssignment } from "./offer.js";

/**
 * Staffing, prepared the moment a job is booked.
 *
 * Crew staffing is the reference studio's single biggest time sink — one to
 * two hours an event, sometimes a day — and until now the product only helped
 * once the studio went looking for help: open the cascade screen, choose a
 * specialty, read a ranked list, pick people, set a rate and a window, submit.
 * Everything in that list is derivable from the booking itself.
 *
 * So booking now writes the plan. `crewStaffingPlans/{projectId}` holds one
 * role per person the package still has to hire, each with its own ranked
 * shortlist, the window from the approved schedule, the rate from the roster,
 * and the venue. The studio opens the job and approves it.
 *
 * ## It prepares; it does not send
 *
 * An offer carries a fee, and the product's rule is that a consequential
 * outward action keeps a human approval point. So the default is a prepared
 * plan and one approval. A studio that has watched the ranking and wants it to
 * run without them can turn on `crewOffers.autoOfferOnBooking` — the same
 * trust dial `lifecycleMessaging` already offers for client mail — and then
 * the first offer of each role goes out here.
 *
 * ## A short role is still in the plan
 *
 * A role nobody can work is written down carrying its reason rather than
 * dropped. A studio that is one videographer short finds out at booking, not
 * in the week of the wedding.
 */

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The window to offer, from the approved schedule if there is one. */
function offerWindow(
  project: DocumentSnapshot,
  schedule: DocumentSnapshot | null,
): { arrivalAt: string; departureAt: string } | null {
  const eventDate = text(project.get("eventDate"));
  if (!eventDate) return null;
  const items = list(schedule?.get("items"))
    .map((value) =>
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : {},
    )
    .filter(
      (item) =>
        Number.isFinite(Date.parse(text(item.startAt))) &&
        Number.isFinite(Date.parse(text(item.endAt))),
    )
    .sort(
      (left, right) =>
        Date.parse(text(left.startAt)) - Date.parse(text(right.startAt)),
    );
  const first = items[0];
  const last = items.at(-1);
  return {
    // No schedule yet is the normal case at booking — the run of show is
    // built later — so fall back to a plain daytime window the studio can
    // correct, exactly as the staffing screen has always done.
    arrivalAt: first
      ? new Date(text(first.startAt)).toISOString()
      : new Date(`${eventDate}T12:00:00.000Z`).toISOString(),
    departureAt: last
      ? new Date(text(last.endAt)).toISOString()
      : new Date(`${eventDate}T20:00:00.000Z`).toISOString(),
  };
}

const STANDARD_REQUIREMENTS = [
  {
    id: "w9",
    name: "W-9 on file",
    kind: "w9",
    required: true,
    dueAt: null,
    instructions: "Upload a current signed W-9 for studio review.",
  },
  {
    id: "insurance",
    name: "Liability insurance",
    kind: "insurance",
    required: true,
    dueAt: null,
    instructions: "Upload a current certificate of liability insurance.",
  },
  {
    id: "schedule",
    name: "Current schedule acknowledged",
    kind: "acknowledgement",
    required: true,
    dueAt: null,
    instructions:
      "Review and acknowledge the current schedule before event day.",
  },
];

export async function prepareCrewStaffing(input: {
  tenantId: string;
  projectId: string;
  actorId: string;
  now: string;
  db?: Firestore;
}): Promise<{
  projectId: string;
  toBook: number;
  roles: { role: string; candidateIds: string[]; gap: string | null }[];
  autoOffered: boolean;
  skipped?: string;
}> {
  const db = input.db ?? getFirestore();
  const planReference = db.doc(`crewStaffingPlans/${input.projectId}`);
  const [project, existingPlan, tenant] = await Promise.all([
    db.doc(`projects/${input.projectId}`).get(),
    planReference.get(),
    db.doc(`tenants/${input.tenantId}`).get(),
  ]);
  if (!project.exists || project.get("tenantId") !== input.tenantId)
    throw new Error("PROJECT_NOT_FOUND");
  // Idempotent: a retry of the booking job must not re-offer anything.
  if (existingPlan.exists)
    return {
      projectId: input.projectId,
      toBook: Number(existingPlan.get("toBook") ?? 0),
      roles: [],
      autoOffered: Boolean(existingPlan.get("autoOffered")),
      skipped: "already_prepared",
    };

  const snapshotId = text(project.get("packageSnapshotId"));
  const [snapshot, schedules, profileDocs, availabilityDocs, acceptedDocs] =
    await Promise.all([
      snapshotId
        ? db.doc(`packageSnapshots/${snapshotId}`).get()
        : Promise.resolve(null),
      db
        .collection("schedules")
        .where("tenantId", "==", input.tenantId)
        .where("projectId", "==", input.projectId)
        .get(),
      // Filtered on tenant alone and narrowed below: there is no composite
      // index on archivedAt and a roster is small enough not to need one.
      db
        .collection("crewProfiles")
        .where("tenantId", "==", input.tenantId)
        .get(),
      db
        .collection("crewAvailability")
        .where("tenantId", "==", input.tenantId)
        .get(),
      db
        .collection("crewAssignments")
        .where("tenantId", "==", input.tenantId)
        .where("status", "==", "accepted")
        .get(),
    ]);

  const coverage = resolveCoverage(snapshot?.data());
  const latestSchedule =
    schedules.docs
      .filter((document) => document.get("status") === "approved")
      .sort(
        (left, right) =>
          Number(right.get("version") ?? 0) - Number(left.get("version") ?? 0),
      )[0] ?? null;
  const window = offerWindow(project, latestSchedule);
  if (!window)
    return {
      projectId: input.projectId,
      toBook: 0,
      roles: [],
      autoOffered: false,
      skipped: "no_event_date",
    };

  const eventSpecialty = (text(project.get("eventType")) || "weddings")
    .toLocaleLowerCase()
    // "Wedding" on the project, "weddings" on a crew profile.
    .replace(/^wedding$/, "weddings");

  const roster = profileDocs.docs.filter(
    (profile) => !profile.get("archivedAt"),
  );
  const candidates: CrewCandidateInput[] = roster.map((profile) => ({
    id: profile.id,
    name: text(profile.get("name")) || "Crew member",
    active: profile.get("active") === true,
    specialties: list(profile.get("specialties")).map(String),
    serviceAreas: list(profile.get("serviceAreas")).map(String),
    travelRadiusMiles: Number(profile.get("travelRadiusMiles") ?? 0),
    preferenceRank: Number.isFinite(Number(profile.get("preferenceRank")))
      ? Number(profile.get("preferenceRank"))
      : null,
    w9Status: text(profile.get("w9Status")),
    insuranceStatus: text(profile.get("insuranceStatus")),
    contractStatus: text(profile.get("contractStatus")),
    availability: availabilityDocs.docs
      .filter((item) => item.get("crewProfileId") === profile.id)
      .flatMap((item) => {
        const status = text(item.get("status"));
        return status === "available" ||
          status === "unavailable" ||
          status === "tentative"
          ? [
              {
                startsAt: text(item.get("startsAt")),
                endsAt: text(item.get("endsAt")),
                status,
              },
            ]
          : [];
      }),
    acceptedAssignments: acceptedDocs.docs
      .filter((item) => item.get("crewProfileId") === profile.id)
      .map((item) => ({
        startsAt: text(item.get("arrivalAt")),
        endsAt: text(item.get("departureAt")),
      })),
  }));

  const plan = planCrewStaffing({
    coverage,
    eventSpecialty,
    serviceArea: text(project.get("city")),
    startsAt: window.arrivalAt,
    endsAt: window.departureAt,
    candidates,
    depth: 5,
  });

  const settings =
    typeof tenant.get("crewOffers") === "object" && tenant.get("crewOffers")
      ? (tenant.get("crewOffers") as Record<string, unknown>)
      : {};
  const responseWindowHours = Math.min(
    168,
    Math.max(1, Number(settings.responseWindowHours ?? 24)),
  );
  // The rate the studio already pays this trade, per role rather than one
  // number for everybody: a videographer's day rate is not a second
  // shooter's.
  const rateFor = (specialty: string) => {
    const preferred = roster.find(
      (profile) =>
        profile.get("active") === true &&
        list(profile.get("specialties")).map(String).includes(specialty),
    );
    const rate = Number(preferred?.get("rateCents"));
    return Number.isFinite(rate) && rate >= 0 ? Math.round(rate) : null;
  };

  const locations = [
    {
      name: text(project.get("venueName")) || "Event location",
      address: text(project.get("venueAddress")) || null,
    },
  ];
  const responsibilities = list(latestSchedule?.get("items"))
    .map((value) =>
      typeof value === "object" && value !== null
        ? text((value as Record<string, unknown>).title)
        : "",
    )
    .filter(Boolean);

  const roles = plan.roles.map((role) => ({
    role: role.role,
    coverageRole: role.coverageRole,
    specialty: role.specialty,
    compensationCents: rateFor(role.specialty),
    candidateIds: role.candidates.map((candidate) => candidate.crewProfileId),
    candidateNames: role.candidates.map((candidate) => candidate.name),
    gap: role.gap,
  }));

  /**
   * Never auto-offer an imported booking.
   *
   * An imported wedding was booked somewhere else, months ago, and is very
   * likely already staffed — offering its crew automatically would send a fee
   * to someone for work that is already arranged. The plan is still prepared,
   * because a studio that has *not* staffed it wants the shortlist; it just
   * never leaves the building on its own. Same posture as ADR 0005.
   */
  const imported = Boolean(project.get("importedAt"));
  const autoOffer = settings.autoOfferOnBooking === true && !imported;
  const offerable = roles.filter((role) => role.candidateIds.length > 0);
  const offers: { cascadeId: string; assignmentId: string; role: string }[] = [];

  const batch = db.batch();
  if (autoOffer && offerable.length) {
    const currency = text(tenant.get("currency")) || "USD";
    for (const [index, role] of offerable.entries()) {
      const cascadeId = `auto_${input.projectId}_role_${index + 1}`;
      const assignmentId = `${cascadeId}_offer_1`;
      const profile = roster.find(
        (candidate) => candidate.id === role.candidateIds[0],
      );
      if (!profile) continue;
      const cascadeRecord = {
        id: cascadeId,
        tenantId: input.tenantId,
        projectId: input.projectId,
        projectName: project.get("name") ?? null,
        role: role.role,
        candidateIds: role.candidateIds,
        responseWindowHours,
        compensationCents: role.compensationCents,
        compensationType: "event",
        currency,
        compensationVisibleToCrew: true,
        arrivalAt: window.arrivalAt,
        departureAt: window.departureAt,
        locations,
        responsibilities,
        scheduleItemIds: [],
        currentScheduleId: latestSchedule?.id ?? null,
        currentScheduleVersion: Number(latestSchedule?.get("version") ?? 0),
        requirements: STANDARD_REQUIREMENTS,
        crewPlanId: `auto_${input.projectId}`,
        status: "active",
        currentCandidateIndex: 0,
        currentAssignmentId: assignmentId,
        acceptedAssignmentId: null,
        handlingStartedAt: input.now,
        handlingCompletedAt: null,
        escalatedAt: null,
        createdAt: input.now,
        updatedAt: input.now,
        createdBy: input.actorId,
        updatedBy: input.actorId,
        archivedAt: null,
      };
      const prepared = cascadeAssignment({
        id: assignmentId,
        tenantId: input.tenantId,
        cascadeId,
        candidateIndex: 0,
        profile,
        cascade: cascadeRecord,
        token: randomBytes(32).toString("base64url"),
        now: input.now,
        actorId: input.actorId,
      });
      batch.create(db.doc(`crewCascades/${cascadeId}`), {
        ...cascadeRecord,
        currentOfferExpiresAt: prepared.expiresAt,
      });
      batch.create(
        db.doc(`crewAssignments/${assignmentId}`),
        prepared.assignment,
      );
      batch.create(db.doc(`emailJobs/${prepared.emailJob.id}`), prepared.emailJob);
      offers.push({ cascadeId, assignmentId, role: role.role });
    }
  }

  batch.create(planReference, {
    id: input.projectId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    preparedAt: input.now,
    preparedBy: input.actorId,
    // Recorded so the screen can say why nothing went out on its own.
    autoOfferSuppressed: imported ? "imported_booking" : null,
    // "prepared" waits on the studio; "offered" means the offers are out.
    status: offers.length ? "offered" : "prepared",
    autoOffered: offers.length > 0,
    offers,
    coverageTotal: plan.coverageTotal,
    toBook: plan.toBook,
    studioCovers: plan.studioCovers,
    eventSpecialty,
    serviceArea: text(project.get("city")),
    arrivalAt: window.arrivalAt,
    departureAt: window.departureAt,
    responseWindowHours,
    locations,
    responsibilities,
    currency: text(tenant.get("currency")) || "USD",
    currentScheduleId: latestSchedule?.id ?? null,
    currentScheduleVersion: Number(latestSchedule?.get("version") ?? 0),
    requirements: STANDARD_REQUIREMENTS,
    roles,
    createdAt: input.now,
    updatedAt: input.now,
    archivedAt: null,
  });
  await batch.commit();

  return {
    projectId: input.projectId,
    toBook: plan.toBook,
    roles: roles.map((role) => ({
      role: role.role,
      candidateIds: role.candidateIds,
      gap: role.gap?.reason ?? null,
    })),
    autoOffered: offers.length > 0,
  };
}
