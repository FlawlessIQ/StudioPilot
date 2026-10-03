import { createHash, randomBytes } from "node:crypto";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { clientOutreachStop } from "../post-event/client-outreach.js";

/**
 * COI automation (H3, docs/coi-automation-plan-2026-09-28.md).
 *
 * Most of the pipeline existed — a request email with a coi+ reply address,
 * inbound PDF, scan, AI extraction, human decision, send to venue — but every
 * run started with the studio typing the agent's email and the venue's legal
 * details, and finished with two separate clicks. This is the start and the
 * finish:
 *
 * - the studio saves who sends its certificates once (an agent, or its
 *   insurer's portal), with a trust dial: off, prepare (the default — the
 *   studio approves each request) or auto;
 * - a booked job whose venue needs a certificate gets one asked for, no
 *   earlier than the lead time before the event (Q14), from venue memory
 *   when the studio has shot there before;
 * - the certificate that comes back is approved and sent to the venue in one
 *   command.
 */

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export const coiSettingsInput = z
  .object({
    source: z.enum(["agent", "self_serve"]),
    agentName: z.string().trim().max(120).nullable().default(null),
    agency: z.string().trim().max(160).nullable().default(null),
    agentEmail: z.string().trim().email().nullable().default(null),
    agentPhone: z.string().trim().max(40).nullable().default(null),
    /** Copy the studio on requests to the agent. */
    ccStudio: z.boolean().default(false),
    portalUrl: z.string().trim().url().nullable().default(null),
    leadDays: z.number().int().min(7).max(365).default(60),
    chaseEveryDays: z.number().int().min(1).max(14).default(3),
    maxChases: z.number().int().min(1).max(10).default(4),
    agentNotes: z.string().trim().max(1000).nullable().default(null),
    dial: z.enum(["off", "prepare", "auto"]).default("prepare"),
  })
  .superRefine((value, context) => {
    if (value.source === "agent" && !value.agentEmail) {
      context.addIssue({ code: "custom", path: ["agentEmail"], message: "COI_AGENT_EMAIL_REQUIRED" });
    }
  });

export type CoiSettings = z.infer<typeof coiSettingsInput>;

export const COI_DEFAULTS = { leadDays: 60, chaseEveryDays: 3, maxChases: 4 } as const;

/** The settings as stored, with defaults for anything missing; null when none are saved. */
export function readCoiSettings(snapshot: DocumentSnapshot | null | undefined): CoiSettings | null {
  if (!snapshot?.exists) return null;
  const parsed = coiSettingsInput.safeParse(snapshot.data());
  return parsed.success ? parsed.data : null;
}

export async function saveCoiSettings(
  db: Firestore,
  context: { tenantId: string; actorId: string; role: string; now: string },
  input: CoiSettings,
): Promise<Record<string, unknown>> {
  if (!["studio_owner", "studio_admin"].includes(context.role)) throw new Error("FORBIDDEN");
  const reference = db.doc(`coiSettings/${context.tenantId}`);
  const before = await reference.get();
  const previousDial = text(before.get("dial")) || "prepare";
  // The dial lets StudioCue email someone on the studio's behalf with no one
  // pressing send: owner-only, like the crew offer dial.
  if (input.dial !== previousDial && context.role !== "studio_owner") throw new Error("COI_DIAL_OWNER_ONLY");
  const batch = db.batch();
  batch.set(reference, {
    ...input,
    tenantId: context.tenantId,
    updatedAt: context.now,
    updatedBy: context.actorId,
    ...(before.exists ? {} : { createdAt: context.now, createdBy: context.actorId }),
  });
  batch.create(db.doc(`auditEvents/coi_settings_${hash(`${context.tenantId}:${context.now}:${context.actorId}`).slice(0, 32)}`), {
    tenantId: context.tenantId,
    projectId: null,
    actorId: context.actorId,
    actorType: "user",
    action: "coi.settings_saved",
    entityType: "coiSettings",
    entityId: context.tenantId,
    timestamp: context.now,
    before: before.exists ? { dial: previousDial, source: before.get("source") ?? null } : null,
    after: { dial: input.dial, source: input.source },
    ipAddress: null,
    userAgent: null,
    correlationId: null,
    automationRunId: null,
    providerEventId: null,
  });
  await batch.commit();
  return { saved: true, dial: input.dial };
}

// ── Venue memory ────────────────────────────────────────────────────────

/**
 * Which venue this is, stably: the place id when the address was looked up,
 * else the name, normalised. The second wedding at a venue needs no typing.
 */
export function venueKey(venue: { placeId?: unknown; name?: unknown }): string | null {
  const placeId = text(venue.placeId);
  if (placeId) return `place_${hash(placeId).slice(0, 24)}`;
  const name = text(venue.name).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return name ? `name_${hash(name).slice(0, 24)}` : null;
}

/** The job's venue, from wherever the record keeps it. */
export function projectVenue(project: DocumentSnapshot): {
  name: string;
  address: string;
  placeId: string;
} {
  // `venue` is the captured place (features/places/schema.ts): `formatted`
  // is the whole address on one line.
  const venue = (project.get("venue") ?? {}) as Record<string, unknown>;
  const name = text(project.get("venueName")) || text(venue.name);
  const address =
    text(venue.formatted) || text(venue.formattedAddress) || text(project.get("venueAddress")) || "";
  return { name, address, placeId: text(venue.placeId) };
}

export type VenueCoiProfile = {
  certificateHolder: string;
  venueLegalName: string;
  venueAddress: string;
  additionalInsuredWording: string | null;
  requiredLimits: Record<string, number>;
  coverageTypes: string[];
  submissionEmail: string | null;
  waiverOfSubrogation: boolean;
  primaryNoncontributory: boolean;
};

export function venueProfileId(tenantId: string, key: string): string {
  return `${tenantId}_${key}`;
}

/** Remember what this venue asked for, once a certificate has gone to it. */
export function venueProfileFrom(requirement: DocumentSnapshot, submissionEmail: string | null): VenueCoiProfile {
  const limits = (requirement.get("requiredLimits") ?? {}) as Record<string, unknown>;
  return {
    certificateHolder: text(requirement.get("certificateHolder")),
    venueLegalName: text(requirement.get("venueLegalName")),
    venueAddress: text(requirement.get("venueAddress")),
    additionalInsuredWording: text(requirement.get("additionalInsuredWording")) || null,
    requiredLimits: Object.fromEntries(
      Object.entries(limits).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
    ),
    coverageTypes: Array.isArray(requirement.get("coverageTypes"))
      ? (requirement.get("coverageTypes") as unknown[]).map(String)
      : ["General liability"],
    submissionEmail: submissionEmail || text(requirement.get("submissionEmail")) || null,
    waiverOfSubrogation: requirement.get("waiverOfSubrogation") === true,
    primaryNoncontributory: requirement.get("primaryNoncontributory") === true,
  };
}

/**
 * The key a requirement's venue is remembered under: the one it was created
 * with, else the job's venue (as the automatic request keys it), else the
 * legal name. Manual requests once wrote no key, so the profile saved on
 * sending was keyed by the typed legal name and the next automatic request —
 * keyed by the place, or the job's venue name — never found it.
 */
export async function venueKeyForRequirement(db: Firestore, requirement: DocumentSnapshot): Promise<string | null> {
  const stored = text(requirement.get("venueKey"));
  if (stored) return stored;
  const projectId = text(requirement.get("projectId"));
  if (projectId) {
    const project = await db.doc(`projects/${projectId}`).get();
    if (project.exists && project.get("tenantId") === requirement.get("tenantId")) {
      const key = venueKey(projectVenue(project));
      if (key) return key;
    }
  }
  return venueKey({ name: requirement.get("venueLegalName") });
}

/**
 * Every key a venue may have been remembered under, best first: its place,
 * then its name — a profile saved before requests carried the place's key
 * (a manual request keyed by name) is still found.
 */
export function venueKeyCandidates(venue: { placeId?: unknown; name?: unknown }): string[] {
  const keys = [venueKey(venue), venueKey({ name: venue.name })];
  return keys.filter((key, index): key is string => Boolean(key) && keys.indexOf(key) === index);
}

// ── The agent's email ──────────────────────────────────────────────────

/**
 * What the agent is asked for, on every path — manual, automatic, prepared.
 *
 * The automatic and prepared requests once sent only the holder, address,
 * cover and dates: the venue's additional-insured wording, waiver and
 * primary/noncontributory flags stayed on the requirement record, and the
 * studio's standing notes for its agent never left the settings page. A
 * certificate issued without the venue's wording comes back wrong.
 */
export function coiAgentRequirement(
  requirement: Record<string, unknown>,
  studioNotes: string | null | undefined,
): Record<string, unknown> {
  const notes = [text(requirement.specialInstructions), text(studioNotes)].filter(Boolean);
  return {
    certificateHolder: requirement.certificateHolder ?? null,
    venueLegalName: requirement.venueLegalName ?? null,
    venueAddress: requirement.venueAddress ?? null,
    eventDate: requirement.eventDate ?? null,
    coverageTypes: requirement.coverageTypes ?? null,
    requiredLimits: requirement.requiredLimits ?? null,
    dueDate: requirement.dueDate ?? null,
    additionalInsuredWording: text(requirement.additionalInsuredWording) || null,
    waiverOfSubrogation: requirement.waiverOfSubrogation === true,
    primaryNoncontributory: requirement.primaryNoncontributory === true,
    // The venue's instructions, then the studio's standing notes — once each:
    // an older automatic request stored the notes as its instructions.
    specialInstructions: notes.filter((note, index) => notes.indexOf(note) === index).join("\n") || null,
  };
}

// ── The automatic request ───────────────────────────────────────────────

const BOOKED_STATES = ["BOOKED", "PLANNING", "READY"];
const DAY_MS = 86_400_000;

/** A certificate is asked for no earlier than the lead time before the event (Q14). */
export function coiDue(eventDate: string, leadDays: number, now: string): {
  askFrom: string;
  dueDate: string;
  timeToAsk: boolean;
} {
  const event = Date.parse(`${eventDate}T12:00:00.000Z`);
  const askFrom = new Date(event - leadDays * DAY_MS).toISOString().slice(0, 10);
  // Three weeks ahead of the event: the same day the readiness checkpoint
  // "COI approved and sent" is due (workflow/starter-templates.ts, -21), so
  // the agent is never told a later date than the studio is held to, and a
  // certificate that comes back wrong still has time to be corrected. Never
  // before the day after tomorrow.
  const due = Math.max(event - 21 * DAY_MS, Date.parse(now) + 2 * DAY_MS);
  return {
    askFrom,
    dueDate: new Date(due).toISOString().slice(0, 10),
    timeToAsk: now.slice(0, 10) >= askFrom && now.slice(0, 10) <= eventDate,
  };
}

export function coiRequestIds(projectId: string) {
  return {
    requestId: `coi_auto_${projectId}`,
    requirementId: `coi_requirement_auto_${projectId}`,
  };
}

/** The request email to the agent, and the reply token its address carries. */
export function agentRequestEmail(input: {
  tenantId: string;
  projectId: string;
  requestId: string;
  agentEmail: string;
  ccEmail: string | null;
  requirement: Record<string, unknown>;
  now: string;
}): { job: Record<string, unknown>; tokenHash: string } {
  const replyDomain = process.env.SENDGRID_INBOUND_DOMAIN;
  if (!replyDomain) throw new Error("COI_INBOUND_DOMAIN_NOT_CONFIGURED");
  const token = randomBytes(32).toString("base64url");
  return {
    tokenHash: hash(token),
    job: {
      id: `coi_request_${input.requestId}`,
      tenantId: input.tenantId,
      projectId: input.projectId,
      type: "coi_request",
      requestId: input.requestId,
      recipient: input.agentEmail,
      ...(input.ccEmail ? { cc: [input.ccEmail] } : {}),
      replyAddress: `coi+${token}@${replyDomain}`,
      requirement: input.requirement,
      status: "queued",
      attempts: 0,
      createdAt: input.now,
      updatedAt: input.now,
    },
  };
}

/**
 * Ask for this job's certificate, if it is time and nothing has been asked.
 * Returns what happened, for the sweep's log and the tests.
 */
export async function autoRequestForProject(
  db: Firestore,
  project: DocumentSnapshot,
  now: string,
): Promise<string> {
  const tenantId = text(project.get("tenantId"));
  const eventDate = text(project.get("eventDate")).slice(0, 10);
  if (!tenantId || !eventDate) return "no_event_date";
  if (project.get("insuranceRequired") !== "required") return "not_required";
  if (!BOOKED_STATES.includes(text(project.get("state")))) return "not_booked";
  // Rechecked at send time, like every scheduled client email: a paused,
  // cancelled or filed-away job is never written about.
  if (clientOutreachStop(project.data())) return "outreach_stopped";
  const [settingsDoc, subscription, existing] = await Promise.all([
    db.doc(`coiSettings/${tenantId}`).get(),
    db.doc(`subscriptions/${tenantId}`).get(),
    db.collection("insuranceRequests").where("tenantId", "==", tenantId).where("projectId", "==", project.id).limit(1).get(),
  ]);
  if (!existing.empty) return "already_requested";
  const settings = readCoiSettings(settingsDoc);
  if (!settings || settings.dial === "off") return "not_set_up";
  if (subscription.get("entitlements.coiEnabled") !== true) return "not_entitled";
  const due = coiDue(eventDate, settings.leadDays, now);
  if (!due.timeToAsk) return "not_yet";

  const venue = projectVenue(project);
  const key = venueKey(venue);
  const [remembered, venueVendor] = await Promise.all([
    // The venue's own key first, then its name: a profile saved before
    // requests carried the place's key is still found.
    Promise.all(
      venueKeyCandidates(venue).map((candidate) => db.doc(`venueCoiProfiles/${venueProfileId(tenantId, candidate)}`).get()),
    ).then((found) => found.find((snapshot) => snapshot.exists && snapshot.get("tenantId") === tenantId) ?? null),
    // The coordinator the couple named on their inquiry (intake/convert.ts).
    db.doc(`vendors/vendor_venue_${project.id}`).get(),
  ]);
  const profile = remembered ? (remembered.data() as VenueCoiProfile) : null;
  const venueLegalName = profile?.venueLegalName || venue.name;
  const venueAddress = profile?.venueAddress || venue.address;
  const { requestId, requirementId } = coiRequestIds(project.id);
  const requirement = {
    certificateHolder: profile?.certificateHolder || venueLegalName,
    venueLegalName,
    venueAddress,
    eventDate,
    coverageTypes: profile?.coverageTypes?.length ? profile.coverageTypes : ["General liability"],
    requiredLimits: profile?.requiredLimits ?? { generalLiability: 100_000_000 },
    dueDate: due.dueDate,
    // The venue's wording, from the last certificate sent there.
    additionalInsuredWording: profile?.additionalInsuredWording ?? null,
    waiverOfSubrogation: profile?.waiverOfSubrogation ?? false,
    primaryNoncontributory: profile?.primaryNoncontributory ?? false,
    // The venue's own instructions. The studio's standing notes join them in
    // the email as it goes (coiAgentRequirement), so an edit to the notes
    // made after a request was prepared still reaches the agent.
    specialInstructions: null,
  };
  const missing = !venueLegalName || venueAddress.length < 5;
  const status = missing
    ? "needs_details"
    : settings.source === "self_serve"
      ? "self_serve"
      : settings.dial === "prepare"
        ? "prepared"
        : "requested";
  const email =
    status === "requested"
      ? agentRequestEmail({
          tenantId,
          projectId: project.id,
          requestId,
          agentEmail: settings.agentEmail!,
          ccEmail: null,
          requirement: coiAgentRequirement(requirement, settings.agentNotes),
          now,
        })
      : null;
  const batch = db.batch();
  batch.create(db.doc(`insuranceRequirements/${requirementId}`), {
    id: requirementId,
    tenantId,
    projectId: project.id,
    status,
    ...requirement,
    submissionEmail:
      profile?.submissionEmail ??
      (venueVendor.exists && venueVendor.get("tenantId") === tenantId ? text(venueVendor.get("email")) || null : null),
    venueKey: key,
    approvedAt: null,
    approvedBy: null,
    createdAt: now,
    updatedAt: now,
    createdBy: "coi-automation",
    updatedBy: "coi-automation",
    archivedAt: null,
  });
  batch.create(db.doc(`insuranceRequests/${requestId}`), {
    id: requestId,
    tenantId,
    projectId: project.id,
    requirementId,
    status,
    autoCreated: true,
    fromVenueMemory: Boolean(profile),
    replyTokenHash: email?.tokenHash ?? null,
    requestEmail: settings.source === "agent" ? settings.agentEmail : null,
    venueName: venueLegalName || null,
    dueDate: due.dueDate,
    inboundMessageId: null,
    documentId: null,
    extractedData: null,
    discrepancies: [],
    humanDecision: "pending",
    requestedAt: status === "requested" ? now : null,
    receivedAt: null,
    sentToVenueAt: null,
    venueAcknowledgedAt: null,
    createdAt: now,
    updatedAt: now,
    createdBy: "coi-automation",
    updatedBy: "coi-automation",
    archivedAt: null,
  });
  if (email) batch.create(db.doc(`emailJobs/${String(email.job.id)}`), email.job);
  batch.create(db.doc(`auditEvents/coi_auto_${project.id}`), {
    tenantId,
    projectId: project.id,
    actorId: "coi-automation",
    actorType: "system",
    action: `coi.auto_${status}`,
    entityType: "insuranceRequest",
    entityId: requestId,
    timestamp: now,
    before: null,
    after: { status, dial: settings.dial, fromVenueMemory: Boolean(profile) },
    ipAddress: null,
    userAgent: null,
    correlationId: `coi_auto_${project.id}`,
    automationRunId: null,
    providerEventId: null,
  });
  try {
    await batch.commit();
  } catch (caught: unknown) {
    // ALREADY_EXISTS: another run asked first. The ids are the job's.
    if ((caught as { code?: unknown }).code === 6) return "already_requested";
    throw caught;
  }
  return status;
}

/** The daily sweep: every booked job whose venue needs a certificate. */
export async function sweepCoiAutoRequests(db: Firestore, now: string): Promise<Record<string, number>> {
  const projects = await db
    .collection("projects")
    .where("insuranceRequired", "==", "required")
    .where("state", "in", BOOKED_STATES)
    .limit(500)
    .get();
  const outcomes: Record<string, number> = {};
  for (const project of projects.docs) {
    try {
      const outcome = await autoRequestForProject(db, project, now);
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    } catch (caught: unknown) {
      outcomes.error = (outcomes.error ?? 0) + 1;
      console.error("coi auto request failed", { projectId: project.id, error: caught instanceof Error ? caught.message : caught });
    }
  }
  return outcomes;
}
