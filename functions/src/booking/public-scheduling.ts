import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { isJobKind, journeyProfile, projectProfile } from "../job-kinds/job-kinds.js";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { commandTypeOf, respondToCommandError } from "../security/command-errors.js";
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
import { mintBookingLink } from "./booking-link.js";
import { consultationPurpose, isFinalDetailsCall } from "./consultation-purpose.js";
import {
  dayFieldsFor,
  normaliseInquiryFormConfig,
  resolveInquiryEventType,
  type InquiryEventKind,
} from "../intake/inquiry-form-config.js";
import {
  INQUIRY_FORM_SOURCE,
  applyCoupleAnswers,
  coupleCompletionPercent,
  coupleFormSections,
  answerIsPresent,
  coupleVisibleAnswers,
  inquiryFormOwed,
  inquiryFormResponseId,
  inquiryDetailsPrefill,
  inquiryFormState,
  jobHasConsultation,
  queueInquiryFormAnalysis,
  questionnaireAnalysisJob,
  questionnaireAnalysisJobId,
} from "../intake/inquiry-form.js";
import { jobPrefill } from "../planning/job-prefill.js";
import { coupleSourceLabel, jobIsBooked } from "../planning/job-facts.js";
import { isReturned, statusAfterSave, submittedAtAfterSave } from "../planning/questionnaire-lifecycle.js";

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
      purpose: z.enum(["consultation", "final_details"]).default("consultation"),
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
      /** Asked for on the page when they pick a phone call and none is on file. */
      phone: z.string().trim().max(30).optional(),
    }),
  }),
  // The studio's event form, before the times (intake/inquiry-form.ts).
  z.object({
    type: z.literal("inquiry_form"),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({ token: inquiryToken }),
  }),
  z.object({
    type: z.literal("inquiry_form_save"),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      token: inquiryToken,
      // Keyed by field id; each value is checked against its question on the
      // server (applyCoupleAnswers), never stored as the browser sent it.
      answers: z
        .record(z.string().max(200), z.unknown())
        .refine((value) => Object.keys(value).length <= 300, "Too many answers"),
      submit: z.boolean(),
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
        const minted = mintBookingLink({
          tenantId: command.tenantId,
          projectId: command.input.projectId,
          contactId: command.input.contactId,
          email,
          mode: command.input.mode,
          purpose: command.input.purpose,
          actorId: identity.uid,
          now,
          days: 14,
        });
        const { linkId, bookingUrl, expiresAt } = minted;
        const emailJobId = `consultation_invite_${linkId}_${Date.now()}`;
        const batch = db.batch();
        batch.set(db.doc(`consultationBookingLinks/${linkId}`), minted.record);
        batch.create(db.doc(`emailJobs/${emailJobId}`), {
          id: emailJobId,
          tenantId: command.tenantId,
          projectId: command.input.projectId,
          contactId: command.input.contactId,
          recipient: email,
          recipientName: String(contact.get("displayName") ?? ""),
          projectName: String(project.get("name") ?? ""),
          type: "consultation_invitation",
          purpose: command.input.purpose,
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
        command.type === "inquiry_cancel" ||
        command.type === "inquiry_form" ||
        command.type === "inquiry_form_save"
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
          // The page says "final details call" for one (consultation-purpose.ts).
          purpose: consultationPurpose(link.data()),
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
        purpose: consultationPurpose(link.data()),
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
      const finalCall = isFinalDetailsCall(link.data());
      if (!finalCall && project.get("state") === "LEAD") {
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
        // Rendered from the consultation when it goes, so it carries the Zoom
        // link the provider worker makes after this (booking/consultation-email.ts).
        consultationId,
        type: "consultation_confirmation",
        purpose: consultationPurpose(link.data()),
        startsAt: selected.startsAt,
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
      await batch.commit();
      // An event form the couple sent from their inquiry page waited for this.
      if (!finalCall) await queueInquiryFormAnalysis(db, {
        tenantId: String(link.get("tenantId")),
        projectId: String(link.get("projectId")),
        now,
      });
      response.status(201).json({
        consultationId,
        startsAt: selected.startsAt,
        endsAt: selected.endsAt,
        timezone: availability.timezone,
        status: "scheduled",
      });
    } catch (caught: unknown) {
      respondToCommandError(response, caught, {
        name: "publicConsultationScheduling",
        commandType: commandTypeOf(request.body),
        status: (message) =>
          message === "FORBIDDEN" ? 403 : message === "RATE_LIMITED" ? 429 : 400,
      });
    }
  },
);

type InquiryCommand = Extract<
  z.infer<typeof commandSchema>,
  {
    type:
      | "inquiry_preview"
      | "inquiry_details"
      | "inquiry_availability"
      | "inquiry_book"
      | "inquiry_cancel"
      | "inquiry_form"
      | "inquiry_form_save";
  }
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
  // The sales call only: the inquiry page must never move or cancel the
  // final details call a month out (consultation-purpose.ts).
  return (
    consultations.docs
      .filter((document) => !isFinalDetailsCall(document.data()))
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
    const [options, upcoming, settings, form] = await Promise.all([
      meetingOptions(db, context.tenantId),
      upcomingConsultation(db, context),
      db.doc(`consultationSettings/${context.tenantId}`).get(),
      inquiryFormState(db, context),
    ]);
    const { known, missing: allMissing } = detailsOf(context.lead);
    // Only what this kind of inquiry is asked: a cheer-photo inquiry was asked
    // for a partner, ceremony time and guest count (2026-10-01).
    const inquiryConfig = normaliseInquiryFormConfig(
      (await db.doc(`leadCaptureSettings/${context.tenantId}`).get().catch(() => null))?.get("inquiryForm"),
    );
    const { type: inquiryType } = resolveInquiryEventType(inquiryConfig, {
      eventType: context.lead.get("eventTypeLabel"),
    });
    const missing = detailsAskedFor(allMissing, inquiryType?.kind ?? null, dayFieldsFor(inquiryType));
    const inquiryBrand = resolveTenantBrand(tenant.data(), "Your photography studio");
    const pastConsultation = pastTheCall(context);
    // How this kind of job runs (job-kinds.ts): a family session or a sports
    // day has no call to book, so the page takes the details and says the
    // price is on its way rather than offering a consultation it never has
    // (walk, 2026-10-03).
    const kindProfile = context.project?.exists
      ? projectProfile(context.project.data())
      : journeyProfile(isJobKind(inquiryType?.kind) ? inquiryType?.kind : null);
    return {
      studioName: inquiryBrand.brandName,
      brandAccentColor: inquiryBrand.primaryColor,
      brandLogoUrl: inquiryBrand.logoUrl,
      firstName: text(context.lead.get("firstName")) || null,
      known,
      missing,
      // "wedding" words only for a wedding; null for an inquiry from before types.
      eventKind: inquiryType?.kind ?? null,
      detailsSubmitted: Boolean(context.lead.get("detailsSubmittedAt")),
      formats: options.formats,
      inPersonLocation: options.inPersonLocation,
      durationMinutes: options.durationMinutes,
      // Without hours set there is nothing to book; the page says so.
      takesBookings: settings.exists,
      offersConsultation: kindProfile.consultation,
      agreement: kindProfile.agreement,
      payment: kindProfile.payment,
      jobKind: kindProfile.kind,
      // A proposal is out: the call happened, so the link stops offering one.
      pastConsultation,
      // Where the job is, so the page names the next thing in their email.
      jobStage: pastConsultation ? jobStageOf(text(context.project?.get("state"))) : null,
      timezone,
      // The studio's event form, asked for before a time is picked. Null when
      // the studio has none, or it isn't for this kind of inquiry.
      eventForm: form
        ? {
            name: text(form.response?.get("templateName")) || text(form.template.get("name")) || "Event form",
            status: form.status,
            // No job yet: the date comes first (the details step), then the form.
            requiresDate: form.requiresDate,
          }
        : null,
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

  if (command.type === "inquiry_form" || command.type === "inquiry_form_save") {
    return handleInquiryForm(db, context, command, now);
  }

  if (command.type === "inquiry_cancel") {
    const upcoming = await upcomingConsultation(db, context);
    if (!upcoming) return { status: "nothing_to_cancel" };
    await upcoming.ref.update({
      status: "cancelled",
      cancelledAt: now,
      cancellationReason: command.input.reason || "Canceled by the couple",
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
      title: `${text(context.lead.get("firstName")) || "The couple"} canceled their consultation (${whenLabel(text(upcoming.get("startsAt")), timezone)})`,
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
  // The studio's event form comes before the call: they need the answers for
  // it. Moving a call already booked is never held up by the form.
  if (!previous && inquiryFormOwed(await inquiryFormState(db, context))) {
    throw new Error("INQUIRY_FORM_REQUIRED");
  }
  // A phone call needs a number to call. A forwarded inquiry often has none,
  // and the call was booked with nothing for the studio to dial (local walk,
  // 2026-10-01). The number they give is kept on the inquiry, as their own.
  const phone = phoneForCall(text(context.lead.get("phone")), command.input.phone);
  if (command.input.format === "phone" && !phone) throw new Error("PHONE_NUMBER_REQUIRED");
  if (command.input.format === "phone" && !text(context.lead.get("phone")) && phone) {
    await saveCoupleDetails(db, context, { phone }, new Date().toISOString());
  }
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
        ? phone
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
    // Rendered from the consultation when it goes, so it carries the Zoom
    // link the provider worker makes after this (booking/consultation-email.ts).
    consultationId,
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
  // The call is what the studio reads the event form for: its AI read goes
  // now, once (queueInquiryFormAnalysis), not when the couple sent it.
  await queueInquiryFormAnalysis(db, { tenantId: context.tenantId, projectId: project.id, now });
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

const plain = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * What the form starts from: the job's facts (planning/job-facts.ts, shared
 * with the studio's "Send the form"), over what the couple told this page a
 * moment ago — their partner's name, their guest count (inquiryDetailsPrefill).
 * A public page: it uses the form's AI map if the studio has one, and never
 * spends on making one.
 */
async function startingAnswers(
  project: FirebaseFirestore.DocumentSnapshot,
  lead: FirebaseFirestore.DocumentSnapshot,
  templateSections: unknown,
  template?: FirebaseFirestore.DocumentSnapshot,
) {
  const fromInquiry = inquiryDetailsPrefill(lead, templateSections);
  const fromJob = await jobPrefill(getFirestore(), {
    tenantId: String(project.get("tenantId") ?? lead.get("tenantId") ?? ""),
    projectId: project.id,
    project: project.data() ?? null,
    leadId: lead.id,
    lead: lead.data() ?? null,
    templateId: template?.id ?? null,
    templateVersion: template?.get("version"),
    sections: templateSections,
    allowAi: false,
  });
  return {
    answers: { ...fromInquiry.answers, ...fromJob.answers },
    answerProvenance: { ...fromInquiry.answerProvenance, ...fromJob.answerProvenance },
    roleChoices: fromJob.roleChoices,
  };
}

/** Saves per inquiry per hour: generous for autosave, a ceiling for a script. */
const INQUIRY_FORM_SAVES_PER_HOUR = 240;

/** A counter per inquiry, like the public inquiry form's (crm/public-lead.ts). */
async function limitInquiryFormSaves(db: FirebaseFirestore.Firestore, leadId: string) {
  const reference = db.doc(`publicRateLimits/inquiry_form_${leadId}`);
  const nowMillis = Date.now();
  const hour = 60 * 60 * 1000;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.data() as { windowStartedAt?: number; count?: number } | undefined;
    const within = Boolean(data?.windowStartedAt) && nowMillis - Number(data?.windowStartedAt) < hour;
    const count = within ? Number(data?.count ?? 0) + 1 : 1;
    if (count > INQUIRY_FORM_SAVES_PER_HOUR) throw new Error("RATE_LIMITED");
    transaction.set(reference, {
      windowStartedAt: within ? Number(data?.windowStartedAt) : nowMillis,
      count,
      expiresAt: new Date(nowMillis + hour * 2).toISOString(),
    });
  });
}

/**
 * The studio's event form on the couple's inquiry page: read it, save it,
 * send it (intake/inquiry-form.ts).
 *
 * Everything that says which studio and which job comes from the token's
 * inquiry (resolveInquiryLink), never from the request. The answers land in
 * an ordinary questionnaireResponses record on the job, so the studio's
 * views, the crew brief and the contract's {{form.answers}} read them as they
 * read a form sent from the job page. No questionnaire_request email goes:
 * the couple is already on the page.
 */
async function handleInquiryForm(
  db: FirebaseFirestore.Firestore,
  context: InquiryLinkContext,
  command: Extract<InquiryCommand, { type: "inquiry_form" | "inquiry_form_save" }>,
  now: string,
): Promise<Record<string, unknown>> {
  const form = await inquiryFormState(db, context);
  if (!form) throw new Error("INQUIRY_FORM_NOT_AVAILABLE");
  // A response belongs to a job, and a dateless inquiry has none yet: the
  // page asks for the date first, which makes one.
  if (form.requiresDate || !context.project) throw new Error("EVENT_DATE_REQUIRED");
  const project = context.project;
  const template = form.template;
  const templateSections = template.get("sections");
  // A copy the studio already sent was answered against its own snapshot.
  const sections = coupleFormSections(
    form.response ? plain(form.response.get("templateSnapshot")).sections : templateSections,
  );
  const name = text(form.response?.get("templateName")) || text(template.get("name")) || "Event form";

  if (command.type === "inquiry_form") {
    // Read from the job either way: "I'm the bride / I'm the groom" is offered
    // until those questions are answered, saved copy or not.
    const starting = await startingAnswers(project, context.lead, templateSections, template);
    const answers = form.response ? plain(form.response.get("answers")) : starting.answers;
    const visibleAnswers = coupleVisibleAnswers(sections, answers);
    // Where each prefilled answer came from, for "Filled in from your booking".
    const provenance = form.response ? plain(form.response.get("answerProvenance")) : starting.answerProvenance;
    // Only while none of those questions is answered yet: after they pick, it's done.
    const roleChoices =
      starting.roleChoices &&
      [...Object.keys(starting.roleChoices.bride), ...Object.keys(starting.roleChoices.groom)].every(
        (fieldId) => !answerIsPresent(answers[fieldId]),
      )
        ? starting.roleChoices
        : null;
    return {
      name,
      sections,
      answers: visibleAnswers,
      sources: Object.fromEntries(
        Object.keys(visibleAnswers).flatMap((fieldId) => {
          const entry = plain(provenance[fieldId]);
          const source = ["project_fact", "inquiry_fact", "earlier_answer", "suggested_time"].includes(text(entry.sourceType))
            ? coupleSourceLabel(text(entry.label), jobIsBooked(project.get("state")))
            : "";
          return source ? [[fieldId, source]] : [];
        }),
      ),
      roleChoices: isReturned(form.status) ? null : roleChoices,
      status: form.status,
      submittedAt: form.response?.get("submittedAt") ?? null,
    };
  }

  await limitInquiryFormSaves(db, context.lead.id);
  const responseId = form.response?.id ?? inquiryFormResponseId(context.tenantId, project.id, template.id);
  const reference = db.doc(`questionnaireResponses/${responseId}`);
  const submit = command.input.submit;
  // The call is already booked (or behind them): the studio needs the read now.
  const analyseNow =
    submit && (pastTheCall(context) || (await jobHasConsultation(db, { tenantId: context.tenantId, projectId: project.id })));
  const outcome = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (
      snapshot.exists &&
      (snapshot.get("tenantId") !== context.tenantId || snapshot.get("projectId") !== project.id)
    ) {
      throw new Error("INQUIRY_FORM_NOT_AVAILABLE");
    }
    const prefill = await startingAnswers(project, context.lead, templateSections, template);
    const priorStatus = snapshot.exists ? text(snapshot.get("status")) || "not_started" : "not_started";
    // Theirs to change until they send it; after that the studio has it.
    if (isReturned(priorStatus)) throw new Error("QUESTIONNAIRE_ALREADY_SUBMITTED");
    const prior = snapshot.exists ? plain(snapshot.get("answers")) : prefill.answers;
    const save = applyCoupleAnswers({ sections, prior, incoming: command.input.answers });
    if (submit && save.missing.length) throw new Error("INQUIRY_FORM_INCOMPLETE");
    const status = statusAfterSave({ prior: priorStatus, submit, byClient: true });
    const submittedAt = submittedAtAfterSave({
      nextStatus: status,
      priorSubmittedAt: snapshot.exists ? snapshot.get("submittedAt") : null,
      byClient: true,
      now,
    });
    const priorProvenance = snapshot.exists ? plain(snapshot.get("answerProvenance")) : prefill.answerProvenance;
    const answerProvenance = { ...priorProvenance };
    const changes = save.changed.map((fieldId) => {
      answerProvenance[fieldId] = {
        sourceType: "client_answer",
        sourceId: fieldId,
        label: "Client answer",
        verified: false,
        changedAt: now,
        changedFrom: prior[fieldId] ?? null,
      };
      return {
        fieldId,
        before: prior[fieldId] ?? null,
        after: save.answers[fieldId],
        affectsPlanning: true,
        changedAt: now,
        changedBy: "couple",
      };
    });
    const completionPercent = isReturned(status) ? 100 : coupleCompletionPercent(sections, save.answers);
    if (!snapshot.exists) {
      // The shape assignQuestionnaire makes (planning/commands.ts), so every
      // reader of questionnaireResponses takes it as it is.
      transaction.create(reference, {
        id: responseId,
        tenantId: context.tenantId,
        projectId: project.id,
        templateId: template.id,
        templateVersion: Number(template.get("version") ?? 1),
        templateName: name,
        templateSnapshot: { name, sections: templateSections },
        status,
        answers: save.answers,
        answerProvenance,
        changeHistory: changes,
        hasPlanningChanges: changes.length > 0,
        completionPercent,
        // No due date and no reminders: the inquiry's own follow-ups carry this
        // page's link, and a portal reminder would invite them somewhere else.
        dueDate: null,
        reminderDaysBeforeDue: [],
        remindersSent: [],
        submittedAt,
        source: INQUIRY_FORM_SOURCE,
        leadId: context.lead.id,
        createdAt: now,
        updatedAt: now,
        createdBy: "couple",
        updatedBy: "couple",
        archivedAt: null,
      });
    } else {
      const history = Array.isArray(snapshot.get("changeHistory")) ? (snapshot.get("changeHistory") as unknown[]) : [];
      transaction.update(reference, {
        answers: save.answers,
        answerProvenance,
        changeHistory: [...history, ...changes].slice(-200),
        hasPlanningChanges: changes.length > 0,
        status,
        completionPercent,
        submittedAt,
        ...(isReturned(status) ? { reopenedAt: null } : {}),
        updatedAt: now,
        updatedBy: "couple",
      });
    }
    // The same analysis a portal submit queues (saveQuestionnaire) — but only
    // once the call is booked. Before that it waits for the booking
    // (queueInquiryFormAnalysis): it is charged to the studio, and a couple
    // who never books shouldn't cost them a run.
    if (submit && analyseNow) {
      transaction.set(
        db.doc(`aiJobs/${questionnaireAnalysisJobId(responseId)}`),
        questionnaireAnalysisJob({ tenantId: context.tenantId, projectId: project.id, responseId, now }),
        { merge: true },
      );
    }
    return { status, submittedAt, missing: save.missing, changed: save.changed.length };
  });

  if (submit) {
    const who = text(context.lead.get("firstName")) || "The couple";
    await recordCoupleAction(db, context, {
      id: `couple_form_${responseId}_${createHash("sha256").update(now).digest("hex").slice(0, 8)}`,
      title: `${who} filled in your ${name}`,
      action: "questionnaire.submitted_from_inquiry",
      after: { responseId, templateId: template.id },
      now,
    });
  }
  return { responseId, ...outcome };
}

/** The number to call: the one on file, else the one just given, if it has enough digits. */
export function phoneForCall(onFile: string, given: string | undefined): string | null {
  for (const candidate of [onFile, given ?? ""]) {
    const value = candidate.trim();
    if (value.replace(/\D/g, "").length >= 7) return value.slice(0, 30);
  }
  return null;
}

/**
 * The details a couple's link asks for, by kind of inquiry. A wedding (or an
 * inquiry from before the studio had types) is asked everything it hasn't
 * said; anything else only what its type asks — never a partner or ceremony
 * time. The date stays: a call is booked against a job, and a job needs one.
 */
export function detailsAskedFor<T extends string>(
  missing: readonly T[],
  kind: InquiryEventKind | null,
  fields: { city: string; venue: boolean; guests: boolean },
): T[] {
  if (kind === null || kind === "wedding") return [...missing];
  return missing.filter((field) => {
    if (field === "partnerName" || field === "ceremonyTime") return false;
    if (field === "venue") return fields.venue;
    if (field === "estimatedGuestCount") return fields.guests;
    if (field === "city") return fields.city !== "hidden";
    return true;
  });
}
