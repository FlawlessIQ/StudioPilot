import { createHash, randomBytes } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { getCalendarBusyIntervals } from "../operations/provider-runtime.js";
import { studioHubCors } from "../security/cors.js";
import { generateConsultationSlots, getConsultationSettings } from "./availability.js";
import {
  detailsOf,
  meetingOptions,
  resolveInquiryLink,
  saveCoupleDetails,
  type InquiryLinkContext,
} from "../intake/inquiry-link.js";
import { resolveTenantBrand } from "../branding/tenant-brand.js";

const inquiryToken = z.string().min(32).max(200);

const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_link"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1),
      contactId: z.string().min(1),
      mode: z.enum(["zoom", "in_person", "phone", "custom"]).default("zoom"),
    }),
  }),
  z.object({
    type: z.literal("preview"),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({ token: z.string().min(32).max(200) }),
  }),
  z.object({
    type: z.literal("availability"),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({ token: z.string().min(32).max(200) }),
  }),
  // The couple's own inquiry link (intake/inquiry-link.ts): their details,
  // then a time and a way to meet, and later a reschedule or cancel.
  z.object({
    type: z.literal("inquiry_preview"),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({ token: inquiryToken }),
  }),
  z.object({
    type: z.literal("inquiry_details"),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      token: inquiryToken,
      details: z.object({
        eventDate: z.string().date().nullable().optional(),
        partnerName: z.string().trim().max(120).nullable().optional(),
        venue: z.string().trim().max(160).nullable().optional(),
        city: z.string().trim().max(120).nullable().optional(),
        ceremonyTime: z.string().trim().max(40).nullable().optional(),
        estimatedGuestCount: z.number().int().min(1).max(100000).nullable().optional(),
        phone: z.string().trim().max(30).nullable().optional(),
        notes: z.string().trim().max(2000).nullable().optional(),
      }),
    }),
  }),
  z.object({
    type: z.literal("inquiry_availability"),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({ token: inquiryToken }),
  }),
  z.object({
    type: z.literal("inquiry_book"),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      token: inquiryToken,
      startsAt: z.string().datetime(),
      format: z.enum(["zoom", "in_person", "phone"]),
    }),
  }),
  z.object({
    type: z.literal("inquiry_cancel"),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({ token: inquiryToken, reason: z.string().trim().max(300).nullable().optional() }),
  }),
  z.object({
    type: z.literal("book"),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      token: z.string().min(32).max(200),
      startsAt: z.string().datetime(),
    }),
  }),
]);

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

async function activeLink(token: string) {
  const tokenHash = hash(token);
  const snapshot = await getFirestore()
    .collection("consultationBookingLinks")
    .where("tokenHash", "==", tokenHash)
    .limit(1)
    .get();
  const link = snapshot.docs[0];
  if (
    !link ||
    link.get("status") !== "pending" ||
    Date.parse(String(link.get("expiresAt"))) <= Date.now()
  ) {
    throw new Error("SCHEDULING_LINK_EXPIRED");
  }
  return link;
}

async function slotsFor(link: FirebaseFirestore.QueryDocumentSnapshot) {
  return slotsForTenant(String(link.get("tenantId")));
}

async function slotsForTenant(tenantId: string) {
  const db = getFirestore();
  const tenant = await db.doc(`tenants/${tenantId}`).get();
  const timezone = String(tenant.get("timezone") ?? "America/New_York");
  const settings = await getConsultationSettings(db, tenantId);
  const rangeStart = new Date();
  rangeStart.setUTCDate(rangeStart.getUTCDate() + 29);
  const existing = await db
    .collection("consultations")
    .where("tenantId", "==", tenantId)
    .where("startsAt", ">=", new Date().toISOString())
    .where("startsAt", "<", rangeStart.toISOString())
    .limit(500)
    .get();
  const busy = existing.docs
    .filter((document) => document.get("status") === "scheduled")
    .map((document) => ({
      start: String(document.get("startsAt")),
      end: String(document.get("endsAt")),
    }));
  // Real calendar conflicts auto-block alongside internal bookings; an
  // unconnected or failing provider degrades to no extra busy time rather
  // than failing the whole scheduling read.
  const calendarBusy = await getCalendarBusyIntervals(
    tenantId,
    new Date().toISOString(),
    rangeStart.toISOString(),
  );
  if (calendarBusy.ok) busy.push(...calendarBusy.busy);
  const slots = generateConsultationSlots({
    settings,
    timezone,
    now: new Date(),
    startInDays: 1,
    daysAhead: 28,
    busy,
    maxSlots: 40,
  });
  return { timezone, durationMinutes: settings.durationMinutes, slots };
}

export const publicConsultationScheduling = onRequest(
  {
    cors: studioHubCors,
    invoker: "private",
    // getCalendarBusyIntervals refreshes the studio's Google token when it is
    // near expiry, and the refresh needs the OAuth client secret. Without this
    // binding the refresh threw GOOGLE_CALENDAR_REFRESH_NOT_CONFIGURED, and
    // because connection() records that on the connection document, a perfectly
    // valid grant flipped to status "error" and the studio's Integrations page
    // showed Google Calendar as disconnected — roughly an hour after every
    // connect, which is how long the first access token lasts.
    secrets: ["GOOGLE_CALENDAR_CLIENT_SECRET"],
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    try {
      await requireAppCheck(request);
      const command = commandSchema.parse(request.body);
      const db = getFirestore();
      const now = new Date().toISOString();

      if (command.type === "create_link") {
        const identity = await requireIdentity(request);
        const membership = await db
          .doc(`memberships/${command.tenantId}_${identity.uid}`)
          .get();
        if (
          !membership.exists ||
          membership.get("status") !== "active" ||
          !["studio_owner", "studio_admin", "studio_coordinator"].includes(
            String(membership.get("role")),
          )
        ) {
          throw new Error("FORBIDDEN");
        }
        const [project, contact, tenant] = await Promise.all([
          db.doc(`projects/${command.input.projectId}`).get(),
          db.doc(`contacts/${command.input.contactId}`).get(),
          db.doc(`tenants/${command.tenantId}`).get(),
        ]);
        if (
          !project.exists ||
          project.get("tenantId") !== command.tenantId ||
          !contact.exists ||
          contact.get("tenantId") !== command.tenantId ||
          !tenant.exists
        ) {
          throw new Error("PROJECT_OR_CONTACT_NOT_FOUND");
        }
        const clients = project.get("clientContactIds");
        if (!Array.isArray(clients) || !clients.includes(command.input.contactId)) {
          throw new Error("CLIENT_NOT_ASSOCIATED_WITH_PROJECT");
        }
        const email = String(contact.get("email") ?? "").toLowerCase();
        if (!z.string().email().safeParse(email).success) {
          throw new Error("CLIENT_EMAIL_REQUIRED");
        }
        const token = randomBytes(32).toString("base64url");
        const linkId = `consult_${hash(`${command.tenantId}:${command.input.projectId}:${email}`).slice(0, 32)}`;
        const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
        const bookingUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app"}/schedule/consultation?token=${encodeURIComponent(token)}`;
        const emailJobId = `consultation_invite_${linkId}_${Date.now()}`;
        const batch = db.batch();
        batch.set(db.doc(`consultationBookingLinks/${linkId}`), {
          id: linkId,
          tenantId: command.tenantId,
          projectId: command.input.projectId,
          contactId: command.input.contactId,
          mode: command.input.mode,
          tokenHash: hash(token),
          status: "pending",
          expiresAt,
          bookedConsultationId: null,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
        });
        batch.create(db.doc(`emailJobs/${emailJobId}`), {
          id: emailJobId,
          tenantId: command.tenantId,
          projectId: command.input.projectId,
          contactId: command.input.contactId,
          recipient: email,
          recipientName: String(contact.get("displayName") ?? ""),
          projectName: String(project.get("name") ?? ""),
          type: "consultation_invitation",
          actionUrl: bookingUrl,
          status: "queued",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        });
        batch.create(db.collection("auditEvents").doc(), {
          tenantId: command.tenantId,
          projectId: command.input.projectId,
          actorId: identity.uid,
          actorType: "user",
          action: "consultation.invitation_sent",
          entityType: "consultation_booking_link",
          entityId: linkId,
          timestamp: now,
          before: null,
          after: { recipient: email, expiresAt },
          correlationId: command.idempotencyKey,
          ipAddress: request.ip ?? null,
          userAgent: request.get("user-agent") ?? null,
          automationRunId: null,
          providerEventId: null,
        });
        await batch.commit();
        response.status(200).json({
          linkId,
          status: "pending",
          expiresAt,
          deliveryStatus: "queued",
        });
        return;
      }

      if (
        command.type === "inquiry_preview" ||
        command.type === "inquiry_details" ||
        command.type === "inquiry_availability" ||
        command.type === "inquiry_book" ||
        command.type === "inquiry_cancel"
      ) {
        const context = await resolveInquiryLink(db, command.input.token);
        const result = await handleInquiryCommand(db, context, command, now);
        response.status(command.type === "inquiry_book" ? 201 : 200).json(result);
        return;
      }

      const link = await activeLink(command.input.token);
      const [tenant, project] = await Promise.all([
        db.doc(`tenants/${String(link.get("tenantId"))}`).get(),
        db.doc(`projects/${String(link.get("projectId"))}`).get(),
      ]);
      if (!tenant.exists || !project.exists) throw new Error("SCHEDULING_LINK_EXPIRED");
      if (command.type === "preview") {
        const brand = resolveTenantBrand(tenant.data(), "Your photography studio");
        response.status(200).json({
          studioName: brand.brandName,
          // The couple sees the studio's brand (mobile-first plan, M2).
          brandAccentColor: brand.primaryColor,
          brandLogoUrl: brand.logoUrl,
          projectName: String(project.get("name") ?? "Your project"),
          eventDate: project.get("eventDate") ?? null,
          expiresAt: link.get("expiresAt"),
          mode: link.get("mode"),
        });
        return;
      }
      const availability = await slotsFor(link);
      if (command.type === "availability") {
        response.status(200).json(availability);
        return;
      }
      const selected = availability.slots.find(
        (slot) => slot.startsAt === command.input.startsAt,
      );
      if (!selected) throw new Error("TIME_NO_LONGER_AVAILABLE");
      const consultationId = `consultation_${hash(`${link.id}:${selected.startsAt}`).slice(0, 32)}`;
      const batch = db.batch();
      batch.create(db.doc(`consultations/${consultationId}`), {
        id: consultationId,
        tenantId: link.get("tenantId"),
        projectId: link.get("projectId"),
        contactId: link.get("contactId"),
        mode: link.get("mode"),
        status: "scheduled",
        startsAt: selected.startsAt,
        endsAt: selected.endsAt,
        timezone: availability.timezone,
        location: null,
        calendarEventId: null,
        calendarHtmlLink: null,
        meetingId: null,
        joinUrl: null,
        providerState:
          process.env.PROVIDER_MOCK_MODE === "true" ? "completed_mock" : "queued",
        internalNotes: null,
        reminderJobIds: [],
        supersedesId: null,
        createdAt: now,
        updatedAt: now,
        createdBy: "public-consultation-scheduler",
        updatedBy: "public-consultation-scheduler",
        archivedAt: null,
      });
      batch.update(link.ref, {
        status: "booked",
        bookedConsultationId: consultationId,
        bookedAt: now,
        updatedAt: now,
        updatedBy: "public-consultation-scheduler",
      });
      if (project.get("state") === "LEAD") {
        batch.update(project.ref, {
          state: "CONSULTATION",
          stateVersion: Number(project.get("stateVersion") ?? 0) + 1,
          nextAction: "Complete consultation",
          updatedAt: now,
          updatedBy: "public-consultation-scheduler",
        });
      }
      if (process.env.PROVIDER_MOCK_MODE !== "true") {
        batch.create(db.doc(`providerJobs/consultation_${consultationId}`), {
          id: `consultation_${consultationId}`,
          tenantId: link.get("tenantId"),
          projectId: link.get("projectId"),
          type: "create_consultation_resources",
          idempotencyKey: consultationId,
          status: "queued",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
      batch.create(db.doc(`emailJobs/consultation_confirmation_${consultationId}`), {
        id: `consultation_confirmation_${consultationId}`,
        tenantId: link.get("tenantId"),
        projectId: link.get("projectId"),
        contactId: link.get("contactId"),
        type: "consultation_confirmation",
        startsAt: selected.startsAt,
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
      await batch.commit();
      response.status(201).json({
        consultationId,
        startsAt: selected.startsAt,
        endsAt: selected.endsAt,
        timezone: availability.timezone,
        status: "scheduled",
      });
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "SCHEDULING_FAILED";
      response.status(message === "FORBIDDEN" ? 403 : 400).json({ error: message });
    }
  },
);

type InquiryCommand = Extract<
  z.infer<typeof commandSchema>,
  { type: "inquiry_preview" | "inquiry_details" | "inquiry_availability" | "inquiry_book" | "inquiry_cancel" }
>;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** The couple's consultation on this inquiry that is still to happen, if any. */
async function upcomingConsultation(
  db: FirebaseFirestore.Firestore,
  context: InquiryLinkContext,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  if (!context.project) return null;
  const consultations = await db
    .collection("consultations")
    .where("tenantId", "==", context.tenantId)
    .where("projectId", "==", context.project.id)
    .limit(20)
    .get();
  const now = new Date().toISOString();
  return (
    consultations.docs
      .filter((document) => document.get("status") === "scheduled" && text(document.get("startsAt")) > now)
      .sort((left, right) => text(left.get("startsAt")).localeCompare(text(right.get("startsAt"))))[0] ?? null
  );
}

/**
 * What the couple did, where the studio will see it: a receipt on the job,
 * which Today lists under "handled for you", and an audit event.
 */
async function recordCoupleAction(
  db: FirebaseFirestore.Firestore,
  context: InquiryLinkContext,
  input: { id: string; title: string; action: string; after: Record<string, unknown>; now: string },
) {
  const projectId = context.project?.id ?? null;
  const batch = db.batch();
  batch.set(db.doc(`actionReceipts/${input.id}`), {
    id: input.id,
    tenantId: context.tenantId,
    projectId,
    title: input.title,
    status: "completed",
    actor: "couple",
    createdAt: input.now,
    updatedAt: input.now,
  });
  batch.set(db.doc(`auditEvents/${input.id}`), {
    id: input.id,
    tenantId: context.tenantId,
    projectId,
    actorId: "couple",
    actorType: "client",
    action: input.action,
    entityType: "lead",
    entityId: context.lead.id,
    timestamp: input.now,
    before: null,
    after: input.after,
    ipAddress: null,
    userAgent: null,
    correlationId: context.lead.id,
    automationRunId: null,
    providerEventId: null,
  });
  await batch.commit();
}

function whenLabel(startsAt: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone || "America/New_York",
  }).format(new Date(startsAt));
}

/**
 * Whether the job has moved past the first call: a proposal is out, or later.
 *
 * The couple's link kept offering "pick a time to talk" to a couple whose
 * studio had marked the call done and sent the proposal (production walk,
 * 2026-09-29). Before a job exists, or while it is still a lead or at the
 * consultation, the call is still ahead.
 */
function jobStageOf(state: string): "proposal" | "agreement" | "retainer" | "booked" {
  if (state === "PROPOSAL") return "proposal";
  if (state === "CONTRACT_PENDING") return "agreement";
  if (state === "RETAINER_PENDING") return "retainer";
  return "booked";
}

function pastTheCall(context: InquiryLinkContext): boolean {
  const state = text(context.project?.get("state"));
  return Boolean(state) && !["LEAD", "CONSULTATION"].includes(state);
}

async function handleInquiryCommand(
  db: FirebaseFirestore.Firestore,
  context: InquiryLinkContext,
  command: InquiryCommand,
  now: string,
): Promise<Record<string, unknown>> {
  const tenant = await db.doc(`tenants/${context.tenantId}`).get();
  const timezone = text(tenant.get("timezone")) || "America/New_York";

  if (command.type === "inquiry_preview") {
    const [options, upcoming, settings] = await Promise.all([
      meetingOptions(db, context.tenantId),
      upcomingConsultation(db, context),
      db.doc(`consultationSettings/${context.tenantId}`).get(),
    ]);
    const { known, missing } = detailsOf(context.lead);
    const inquiryBrand = resolveTenantBrand(tenant.data(), "Your photography studio");
    const pastConsultation = pastTheCall(context);
    return {
      studioName: inquiryBrand.brandName,
      brandAccentColor: inquiryBrand.primaryColor,
      brandLogoUrl: inquiryBrand.logoUrl,
      firstName: text(context.lead.get("firstName")) || null,
      known,
      missing,
      detailsSubmitted: Boolean(context.lead.get("detailsSubmittedAt")),
      formats: options.formats,
      inPersonLocation: options.inPersonLocation,
      durationMinutes: options.durationMinutes,
      // Without hours set there is nothing to book; the page says so.
      takesBookings: settings.exists,
      // A proposal is out: the call happened, so the link stops offering one.
      pastConsultation,
      // Where the job is, so the page names the next thing in their email.
      jobStage: pastConsultation ? jobStageOf(text(context.project?.get("state"))) : null,
      timezone,
      booked: upcoming
        ? {
            startsAt: upcoming.get("startsAt"),
            endsAt: upcoming.get("endsAt"),
            format: upcoming.get("mode"),
            joinUrl: upcoming.get("joinUrl") ?? null,
            location: upcoming.get("location") ?? null,
          }
        : null,
    };
  }

  if (command.type === "inquiry_details") {
    const { saved, projectId } = await saveCoupleDetails(db, context, command.input.details, now);
    if (saved.length || command.input.details.notes) {
      await recordCoupleAction(db, { ...context, project: projectId ? await db.doc(`projects/${projectId}`).get() : null }, {
        id: `couple_details_${context.lead.id}_${createHash("sha256").update(now).digest("hex").slice(0, 8)}`,
        title: `${text(context.lead.get("firstName")) || "The couple"} filled in their details`,
        action: "inquiry.details_submitted",
        after: { fields: saved },
        now,
      });
    }
    return { saved, hasJob: Boolean(projectId) };
  }

  if (command.type === "inquiry_availability") {
    return slotsForTenant(context.tenantId);
  }

  if (command.type === "inquiry_cancel") {
    const upcoming = await upcomingConsultation(db, context);
    if (!upcoming) return { status: "nothing_to_cancel" };
    await upcoming.ref.update({
      status: "cancelled",
      cancelledAt: now,
      cancellationReason: command.input.reason || "Cancelled by the couple",
      updatedAt: now,
      updatedBy: "couple",
    });
    if (process.env.PROVIDER_MOCK_MODE !== "true") {
      await db.doc(`providerJobs/consultation_cancel_${upcoming.id}`).set(
        {
          tenantId: context.tenantId,
          projectId: context.project?.id ?? null,
          consultationId: upcoming.id,
          type: "cancel_consultation_resources",
          idempotencyKey: `couple_cancel_${upcoming.id}`,
          status: "queued",
          createdAt: now,
        },
        { merge: true },
      );
    }
    await recordCoupleAction(db, context, {
      id: `couple_cancel_${upcoming.id}`,
      title: `${text(context.lead.get("firstName")) || "The couple"} cancelled their consultation (${whenLabel(text(upcoming.get("startsAt")), timezone)})`,
      action: "consultation.cancelled_by_couple",
      after: { consultationId: upcoming.id, reason: command.input.reason ?? null },
      now,
    });
    return { status: "cancelled" };
  }

  // inquiry_book — a new consultation, or a move of the one they have.
  if (!context.project) throw new Error("EVENT_DATE_REQUIRED");
  const project = context.project;
  // A call they already have can still move; a new one once a proposal is out
  // is a couple re-entering the start of a job that has moved on.
  if (pastTheCall(context) && !(await upcomingConsultation(db, context))) {
    throw new Error("INQUIRY_PAST_CONSULTATION");
  }
  const options = await meetingOptions(db, context.tenantId);
  if (!options.formats.includes(command.input.format)) throw new Error("FORMAT_NOT_OFFERED");
  const availability = await slotsForTenant(context.tenantId);
  const selected = availability.slots.find((slot) => slot.startsAt === command.input.startsAt);
  if (!selected) throw new Error("TIME_NO_LONGER_AVAILABLE");
  const contactId = text(context.lead.get("primaryContactId")) || (project.get("clientContactIds") as string[] | undefined)?.[0] || null;
  const previous = await upcomingConsultation(db, context);
  const consultationId = `consultation_${createHash("sha256")
    .update(`inquiry:${context.lead.id}:${selected.startsAt}:${command.input.format}`)
    .digest("hex")
    .slice(0, 32)}`;
  if (previous?.id === consultationId) {
    return { consultationId, startsAt: selected.startsAt, endsAt: selected.endsAt, timezone: availability.timezone, status: "scheduled" };
  }
  const location =
    command.input.format === "in_person"
      ? options.inPersonLocation
      : command.input.format === "phone"
        ? text(context.lead.get("phone")) || null
        : null;
  const inquiryUrl = `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app").replace(/\/$/, "")}/i/${command.input.token}`;
  const batch = db.batch();
  batch.create(db.doc(`consultations/${consultationId}`), {
    id: consultationId,
    tenantId: context.tenantId,
    projectId: project.id,
    contactId,
    mode: command.input.format,
    status: "scheduled",
    startsAt: selected.startsAt,
    endsAt: selected.endsAt,
    timezone: availability.timezone,
    location,
    calendarEventId: null,
    calendarHtmlLink: null,
    meetingId: null,
    joinUrl: null,
    providerState: process.env.PROVIDER_MOCK_MODE === "true" ? "completed_mock" : "queued",
    internalNotes: null,
    reminderJobIds: [],
    supersedesId: previous?.id ?? null,
    // Where the couple manages it; carried by the confirmation email.
    selfServeUrl: inquiryUrl,
    createdAt: now,
    updatedAt: now,
    createdBy: "couple",
    updatedBy: "couple",
    archivedAt: null,
  });
  if (previous) {
    batch.update(previous.ref, {
      status: "rescheduled",
      rescheduledAt: now,
      supersededBy: consultationId,
      updatedAt: now,
      updatedBy: "couple",
    });
  }
  if (project.get("state") === "LEAD") {
    batch.update(project.ref, {
      state: "CONSULTATION",
      stateVersion: Number(project.get("stateVersion") ?? 0) + 1,
      nextAction: "Complete consultation",
      updatedAt: now,
      updatedBy: "couple",
    });
  }
  if (process.env.PROVIDER_MOCK_MODE !== "true") {
    batch.create(db.doc(`providerJobs/consultation_${consultationId}`), {
      id: `consultation_${consultationId}`,
      tenantId: context.tenantId,
      projectId: project.id,
      type: "create_consultation_resources",
      idempotencyKey: consultationId,
      status: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    if (previous) {
      batch.set(db.doc(`providerJobs/consultation_cancel_${previous.id}`), {
        tenantId: context.tenantId,
        projectId: project.id,
        consultationId: previous.id,
        type: "cancel_consultation_resources",
        idempotencyKey: `couple_reschedule_${previous.id}`,
        status: "queued",
        createdAt: now,
      }, { merge: true });
    }
  }
  batch.create(db.doc(`emailJobs/consultation_confirmation_${consultationId}`), {
    id: `consultation_confirmation_${consultationId}`,
    tenantId: context.tenantId,
    projectId: project.id,
    contactId,
    type: "consultation_confirmation",
    startsAt: selected.startsAt,
    location,
    // The couple's own page: move or cancel it there.
    rescheduleUrl: inquiryUrl,
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  await batch.commit();
  const who = text(context.lead.get("firstName")) || "The couple";
  const formatLabel = command.input.format === "in_person" ? "in person" : command.input.format === "phone" ? "by phone" : "on Zoom";
  await recordCoupleAction(db, context, {
    id: `couple_book_${consultationId}`,
    title: previous
      ? `${who} moved their consultation to ${whenLabel(selected.startsAt, availability.timezone)}, ${formatLabel}`
      : `${who} booked a consultation for ${whenLabel(selected.startsAt, availability.timezone)}, ${formatLabel}`,
    action: previous ? "consultation.rescheduled_by_couple" : "consultation.booked_by_couple",
    after: { consultationId, startsAt: selected.startsAt, format: command.input.format, previous: previous?.id ?? null },
    now,
  });
  return {
    consultationId,
    startsAt: selected.startsAt,
    endsAt: selected.endsAt,
    timezone: availability.timezone,
    format: command.input.format,
    location,
    rescheduled: Boolean(previous),
    status: "scheduled",
  };
}
