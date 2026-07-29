import { createHash, randomBytes } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";

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
  const db = getFirestore();
  const tenantId = String(link.get("tenantId"));
  const tenant = await db.doc(`tenants/${tenantId}`).get();
  const timezone = String(tenant.get("timezone") ?? "America/New_York");
  const settings =
    typeof tenant.get("consultationSettings") === "object" &&
    tenant.get("consultationSettings") !== null
      ? (tenant.get("consultationSettings") as Record<string, unknown>)
      : {};
  const durationMinutes = Math.min(
    120,
    Math.max(15, Number(settings.durationMinutes ?? 45)),
  );
  const bufferMinutes = Math.min(
    60,
    Math.max(0, Number(settings.bufferMinutes ?? 15)),
  );
  const startHour = Math.min(18, Math.max(7, Number(settings.startHour ?? 9)));
  const endHour = Math.min(21, Math.max(startHour + 1, Number(settings.endHour ?? 17)));
  const rangeStart = new Date();
  rangeStart.setUTCDate(rangeStart.getUTCDate() + 1);
  rangeStart.setUTCHours(0, 0, 0, 0);
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 28);
  const existing = await db
    .collection("consultations")
    .where("tenantId", "==", tenantId)
    .where("startsAt", ">=", rangeStart.toISOString())
    .where("startsAt", "<", rangeEnd.toISOString())
    .limit(500)
    .get();
  const busy = existing.docs
    .filter((document) => document.get("status") === "scheduled")
    .map((document) => ({
      start: Date.parse(String(document.get("startsAt"))),
      end: Date.parse(String(document.get("endsAt"))),
    }));
  const slots: Array<{ startsAt: string; endsAt: string }> = [];
  for (let day = 0; day < 28 && slots.length < 40; day += 1) {
    const date = new Date(rangeStart);
    date.setUTCDate(date.getUTCDate() + day);
    if ([0, 6].includes(date.getUTCDay())) continue;
    for (
      let minutes = startHour * 60;
      minutes + durationMinutes <= endHour * 60 && slots.length < 40;
      minutes += durationMinutes + bufferMinutes
    ) {
      const start = new Date(date);
      start.setUTCHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
      const end = new Date(start.getTime() + durationMinutes * 60_000);
      const overlaps = busy.some(
        (interval) =>
          start.getTime() < interval.end + bufferMinutes * 60_000 &&
          end.getTime() + bufferMinutes * 60_000 > interval.start,
      );
      if (!overlaps) {
        slots.push({
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
        });
      }
    }
  }
  return { timezone, durationMinutes, slots };
}

export const publicConsultationScheduling = onRequest(
  { cors: studioHubCors, invoker: "private" },
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

      const link = await activeLink(command.input.token);
      const [tenant, project] = await Promise.all([
        db.doc(`tenants/${String(link.get("tenantId"))}`).get(),
        db.doc(`projects/${String(link.get("projectId"))}`).get(),
      ]);
      if (!tenant.exists || !project.exists) throw new Error("SCHEDULING_LINK_EXPIRED");
      if (command.type === "preview") {
        response.status(200).json({
          studioName: String(
            tenant.get("brandName") ??
              tenant.get("businessName") ??
              "Your photography studio",
          ),
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
