import type { Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { z } from "zod";
import {
  agentRequestEmail,
  readCoiSettings,
  venueKey,
  venueProfileFrom,
  venueProfileId,
} from "./automation.js";
import { COI_APPROVABLE_STATUSES, planCoiResend } from "./corrections.js";

/**
 * The studio's side of an automated COI (H3, docs/coi-automation-plan-2026-09-28.md):
 * approve the request StudioCue prepared, give it the details it lacked,
 * attach the certificate from the insurer's portal, and approve and send what
 * came back — one command, where it was two separate clicks.
 */

type Context = { tenantId: string; actorId: string; role: string; now: string };
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const STUDIO = ["studio_owner", "studio_admin", "studio_coordinator"];

async function loadRequest(db: Firestore, context: Context, projectId: string, requestId: string) {
  const reference = db.doc(`insuranceRequests/${requestId}`);
  const request = await reference.get();
  if (!request.exists || request.get("tenantId") !== context.tenantId || request.get("projectId") !== projectId) {
    throw new Error("COI_REQUEST_NOT_FOUND");
  }
  const requirement = await db.doc(`insuranceRequirements/${text(request.get("requirementId"))}`).get();
  return { reference, request, requirement };
}

export const approvePreparedCoiInput = z.object({ projectId: z.string(), requestId: z.string() });

/** "Send COI request to your agent": the prepared request goes out (dial: prepare). */
export async function approvePreparedCoi(
  db: Firestore,
  context: Context,
  input: z.infer<typeof approvePreparedCoiInput>,
): Promise<Record<string, unknown>> {
  if (!STUDIO.includes(context.role)) throw new Error("FORBIDDEN");
  const { reference, request, requirement } = await loadRequest(db, context, input.projectId, input.requestId);
  if (request.get("status") !== "prepared") throw new Error("COI_NOT_PREPARED");
  const settings = readCoiSettings(await db.doc(`coiSettings/${context.tenantId}`).get());
  const agentEmail = text(request.get("requestEmail")) || settings?.agentEmail || "";
  if (!agentEmail) throw new Error("COI_AGENT_EMAIL_REQUIRED");
  const email = agentRequestEmail({
    tenantId: context.tenantId,
    projectId: input.projectId,
    requestId: input.requestId,
    agentEmail,
    ccEmail: null,
    requirement: {
      certificateHolder: requirement.get("certificateHolder"),
      venueLegalName: requirement.get("venueLegalName"),
      venueAddress: requirement.get("venueAddress"),
      eventDate: requirement.get("eventDate"),
      coverageTypes: requirement.get("coverageTypes"),
      requiredLimits: requirement.get("requiredLimits"),
      dueDate: requirement.get("dueDate"),
    },
    now: context.now,
  });
  const batch = db.batch();
  batch.create(db.doc(`emailJobs/${String(email.job.id)}`), email.job);
  batch.update(reference, {
    status: "requested",
    replyTokenHash: email.tokenHash,
    requestEmail: agentEmail,
    requestedAt: context.now,
    approvedToSendBy: context.actorId,
    updatedAt: context.now,
    updatedBy: context.actorId,
  });
  batch.update(requirement.ref, { status: "requested", updatedAt: context.now, updatedBy: context.actorId });
  await batch.commit();
  return { requestId: input.requestId, status: "requested" };
}

export const completeCoiDetailsInput = z.object({
  projectId: z.string(),
  requestId: z.string(),
  certificateHolder: z.string().trim().min(2).max(300).optional(),
  venueLegalName: z.string().trim().min(2).max(300),
  venueAddress: z.string().trim().min(5).max(500),
  submissionEmail: z.string().trim().email().nullable().default(null),
});

/**
 * "Confirm the venue's address": what the automatic request could not find,
 * and then the request carries on as the studio's dial says.
 */
export async function completeCoiDetails(
  db: Firestore,
  context: Context,
  input: z.infer<typeof completeCoiDetailsInput>,
): Promise<Record<string, unknown>> {
  if (!STUDIO.includes(context.role)) throw new Error("FORBIDDEN");
  const { reference, request, requirement } = await loadRequest(db, context, input.projectId, input.requestId);
  if (request.get("status") !== "needs_details") throw new Error("COI_DETAILS_NOT_NEEDED");
  const settings = readCoiSettings(await db.doc(`coiSettings/${context.tenantId}`).get());
  const next = settings?.source === "self_serve" ? "self_serve" : "prepared";
  const batch = db.batch();
  batch.update(requirement.ref, {
    certificateHolder: input.certificateHolder ?? input.venueLegalName,
    venueLegalName: input.venueLegalName,
    venueAddress: input.venueAddress,
    ...(input.submissionEmail ? { submissionEmail: input.submissionEmail } : {}),
    status: next,
    updatedAt: context.now,
    updatedBy: context.actorId,
  });
  batch.update(reference, {
    status: next,
    venueName: input.venueLegalName,
    updatedAt: context.now,
    updatedBy: context.actorId,
  });
  await batch.commit();
  // With the dial on auto, confirming the details is the only thing that was
  // missing: the request goes now.
  if (next === "prepared" && settings?.dial === "auto") {
    return approvePreparedCoi(db, context, { projectId: input.projectId, requestId: input.requestId });
  }
  return { requestId: input.requestId, status: next };
}

export const attachCoiUploadInput = z.object({
  projectId: z.string(),
  requestId: z.string(),
  storagePath: z.string().min(10).max(600),
  filename: z.string().trim().min(1).max(255),
});

/**
 * A certificate the studio generated in its insurer's portal (Hiscox, NEXT,
 * Thimble…), uploaded here. It is scanned and checked exactly like one an
 * agent emails: the upload carries the request id, which is what the scanner
 * keys on (operations/file-safety.ts).
 */
export async function attachCoiUpload(
  db: Firestore,
  context: Context,
  input: z.infer<typeof attachCoiUploadInput>,
): Promise<Record<string, unknown>> {
  if (!STUDIO.includes(context.role)) throw new Error("FORBIDDEN");
  const { reference, request } = await loadRequest(db, context, input.projectId, input.requestId);
  if (!["self_serve", "requested", "correction_required", "failed"].includes(text(request.get("status")))) {
    throw new Error("COI_REQUEST_NOT_ACCEPTING");
  }
  const folder = `tenants/${context.tenantId}/projects/${input.projectId}/coi/`;
  if (!input.storagePath.startsWith(folder) || input.storagePath.includes("..")) throw new Error("COI_UPLOAD_PATH_MISMATCH");
  const bucket = getStorage().bucket();
  const [exists] = await bucket.file(input.storagePath).exists();
  if (!exists) throw new Error("COI_UPLOAD_NOT_FOUND");
  // The safety scan can finish before this call lands, and has then already
  // moved the request on (received, or failed): only a request still waiting
  // is moved here, so a finished scan is never rolled back.
  const status = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    const waiting = ["self_serve", "requested", "correction_required"].includes(text(current.get("status")));
    transaction.update(reference, {
      ...(waiting
        ? { status: "received", temporaryObject: `gs://${bucket.name}/${input.storagePath}`, scanStatus: "pending" }
        : {}),
      receivedAt: context.now,
      sourceFilename: input.filename,
      uploadedBy: context.actorId,
      updatedAt: context.now,
      updatedBy: context.actorId,
    });
    return waiting ? "received" : text(current.get("status"));
  });
  return { requestId: input.requestId, status };
}

export const approveAndSendCoiInput = z.object({
  projectId: z.string(),
  requestId: z.string(),
  reason: z.string().trim().min(5).max(2000),
  /** Where it goes, when the request didn't know yet. */
  submissionEmail: z.string().trim().email().nullable().default(null),
});

/**
 * "Approve & send to venue": the human decision and the send, one command
 * (Q18). AI flags stay advisory — this is a person approving what they read.
 * The venue's reply comes back to the request's own coi+ address, which is
 * how "the venue has it" gets recorded (C5).
 */
export async function approveAndSendCoi(
  db: Firestore,
  context: Context,
  input: z.infer<typeof approveAndSendCoiInput>,
): Promise<Record<string, unknown>> {
  if (!["studio_owner", "studio_admin"].includes(context.role)) throw new Error("FORBIDDEN");
  const { reference, request, requirement } = await loadRequest(db, context, input.projectId, input.requestId);
  // Includes a certificate the studio sent back and then decided was right —
  // see COI_APPROVABLE_STATUSES.
  if (!COI_APPROVABLE_STATUSES.includes(text(request.get("status")))) throw new Error("COI_NOT_REVIEWABLE");
  const object = text(request.get("temporaryObject"));
  if (!object.startsWith("gs://")) throw new Error("COI_DOCUMENT_MISSING");
  const submissionEmail = input.submissionEmail ?? (text(requirement.get("submissionEmail")) || null);
  if (!submissionEmail) throw new Error("COI_VENUE_EMAIL_REQUIRED");
  const original = await db.doc(`emailJobs/coi_request_${input.requestId}`).get();
  const replyAddress = text(original.get("replyAddress")) || null;
  const documentId = `coi_${input.requestId}`;
  const batch = db.batch();
  batch.set(db.doc(`documents/${documentId}`), {
    id: documentId,
    tenantId: context.tenantId,
    projectId: input.projectId,
    provider: "cloud_storage",
    providerFileId: object,
    providerRevision: null,
    canonicalPath: object,
    name: text(request.get("sourceFilename")) || "certificate-of-insurance.pdf",
    contentType: "application/pdf",
    sizeBytes: null,
    hash: null,
    visibility: "shared",
    clientVisible: true,
    category: "coi",
    status: "approved",
    createdAt: context.now,
    updatedAt: context.now,
    createdBy: context.actorId,
    updatedBy: context.actorId,
    archivedAt: null,
  });
  batch.set(db.doc(`providerJobs/dropbox_coi_${input.requestId}`), {
    id: `dropbox_coi_${input.requestId}`,
    tenantId: context.tenantId,
    projectId: input.projectId,
    type: "upload_dropbox_document",
    documentId,
    targetFolder: "05_COI",
    status: "queued",
    attempts: 0,
    createdAt: context.now,
    updatedAt: context.now,
  });
  batch.create(db.doc(`emailJobs/coi_venue_${input.requestId}`), {
    id: `coi_venue_${input.requestId}`,
    tenantId: context.tenantId,
    projectId: input.projectId,
    type: "coi_venue_delivery",
    requestId: input.requestId,
    documentId,
    recipient: submissionEmail,
    venueName: requirement.get("venueLegalName"),
    // So the venue can tell which event it is for (walked 2026-09-30).
    eventDate: requirement.get("eventDate") ?? null,
    ...(replyAddress ? { replyAddress } : {}),
    status: "queued",
    attempts: 0,
    createdAt: context.now,
    updatedAt: context.now,
  });
  batch.update(reference, {
    status: "sent_to_venue",
    humanDecision: "approved",
    decisionReason: input.reason,
    decidedAt: context.now,
    decidedBy: context.actorId,
    documentId,
    sentToVenueAt: context.now,
    updatedAt: context.now,
    updatedBy: context.actorId,
  });
  batch.update(requirement.ref, {
    status: "sent_to_venue",
    submissionEmail,
    approvedAt: context.now,
    approvedBy: context.actorId,
    updatedAt: context.now,
    updatedBy: context.actorId,
  });
  // Venue memory: the next wedding here needs no typing.
  const key = text(requirement.get("venueKey")) || venueKey({ name: requirement.get("venueLegalName") });
  if (key) {
    batch.set(db.doc(`venueCoiProfiles/${venueProfileId(context.tenantId, key)}`), {
      ...venueProfileFrom(requirement, submissionEmail),
      tenantId: context.tenantId,
      venueKey: key,
      lastRequestId: input.requestId,
      updatedAt: context.now,
      updatedBy: context.actorId,
    });
  }
  batch.create(db.doc(`auditEvents/coi_approve_send_${input.requestId}`), {
    tenantId: context.tenantId,
    projectId: input.projectId,
    actorId: context.actorId,
    actorType: "user",
    action: "coi.approved_and_sent",
    entityType: "insuranceRequest",
    entityId: input.requestId,
    timestamp: context.now,
    before: { status: request.get("status") },
    after: { status: "sent_to_venue", submissionEmail },
    ipAddress: null,
    userAgent: null,
    correlationId: `coi_approve_send_${input.requestId}`,
    automationRunId: null,
    providerEventId: null,
  });
  await batch.commit();
  return { requestId: input.requestId, status: "sent_to_venue" };
}

export const resendCoiInput = z.object({
  projectId: z.string(),
  requestId: z.string(),
  /** Corrections to what the agent was asked to put on the certificate. */
  certificateHolder: z.string().trim().min(2).max(300).optional(),
  venueLegalName: z.string().trim().min(2).max(300).optional(),
  venueAddress: z.string().trim().min(5).max(500).optional(),
  /** A different agent to ask. */
  agentEmail: z.string().trim().email().nullable().default(null),
  /** Where the venue really wants the certificate. */
  submissionEmail: z.string().trim().email().nullable().default(null),
});

/**
 * Send it again, with the details corrected (see planCoiResend).
 *
 * There was no way to: a request that went out with the wrong venue address
 * could only be chased as it was, and a certificate sent to the wrong venue
 * email had been sent for good. Each resend is its own email job, so nothing
 * already sent is rewritten and a retry cannot send twice.
 */
export async function resendCoi(
  db: Firestore,
  context: Context,
  input: z.infer<typeof resendCoiInput>,
): Promise<Record<string, unknown>> {
  if (!STUDIO.includes(context.role)) throw new Error("FORBIDDEN");
  const { reference, request, requirement } = await loadRequest(db, context, input.projectId, input.requestId);
  const status = text(request.get("status"));
  const corrected: Array<[string, string | undefined]> = [
    ["certificateHolder", input.certificateHolder],
    ["venueLegalName", input.venueLegalName],
    ["venueAddress", input.venueAddress],
  ];
  const venueChanges: Record<string, string> = {};
  for (const [key, value] of corrected) {
    if (value !== undefined && value !== text(requirement.get(key))) venueChanges[key] = value;
  }
  const plan = planCoiResend({
    status,
    role: context.role,
    submissionEmail: input.submissionEmail,
    venueDetailsChanged: Object.keys(venueChanges).length > 0,
    agentEmail: input.agentEmail,
  });
  if (!plan.ok) throw new Error(plan.refusal);
  const resendNumber = Number(request.get("resendCount") ?? 0) + 1;
  const batch = db.batch();

  if (plan.to === "agent") {
    const originalJobId = text(request.get("requestEmailJobId")) || `coi_request_${input.requestId}`;
    const original = await db.doc(`emailJobs/${originalJobId}`).get();
    if (!original.exists) throw new Error("COI_NOT_RESENDABLE");
    const priorRequirement = (original.get("requirement") ?? {}) as Record<string, unknown>;
    const jobId = `coi_request_${input.requestId}_r${resendNumber}`;
    batch.create(db.doc(`emailJobs/${jobId}`), {
      ...original.data(),
      id: jobId,
      recipient: input.agentEmail ?? original.get("recipient"),
      // The same reply address: an answer to either email comes back here.
      requirement: { ...priorRequirement, ...venueChanges },
      correctedResend: resendNumber,
      chaseNumber: null,
      status: "queued",
      attempts: 0,
      createdAt: context.now,
      updatedAt: context.now,
    });
    if (Object.keys(venueChanges).length) {
      batch.update(requirement.ref, { ...venueChanges, updatedAt: context.now, updatedBy: context.actorId });
    }
    batch.update(reference, {
      status: "requested",
      requestEmail: input.agentEmail ?? text(request.get("requestEmail")),
      ...(venueChanges.venueLegalName ? { venueName: venueChanges.venueLegalName } : {}),
      // Chases copy this job from now on, so they repeat the corrected one.
      requestEmailJobId: jobId,
      requestedAt: context.now,
      chaseCount: 0,
      lastChasedAt: null,
      escalatedAt: null,
      escalationReason: null,
      resendCount: resendNumber,
      updatedAt: context.now,
      updatedBy: context.actorId,
    });
  } else {
    const originalJobId = text(request.get("venueEmailJobId")) || `coi_venue_${input.requestId}`;
    const original = await db.doc(`emailJobs/${originalJobId}`).get();
    if (!original.exists) throw new Error("COI_NOT_RESENDABLE");
    const jobId = `coi_venue_${input.requestId}_r${resendNumber}`;
    batch.create(db.doc(`emailJobs/${jobId}`), {
      ...original.data(),
      id: jobId,
      recipient: input.submissionEmail,
      correctedResend: resendNumber,
      status: "queued",
      attempts: 0,
      createdAt: context.now,
      updatedAt: context.now,
    });
    batch.update(requirement.ref, {
      submissionEmail: input.submissionEmail,
      updatedAt: context.now,
      updatedBy: context.actorId,
    });
    batch.update(reference, {
      // The wrong address may have acknowledged; the right one hasn't yet.
      status: "sent_to_venue",
      venueAcknowledgedAt: null,
      venueEmailJobId: jobId,
      sentToVenueAt: context.now,
      resendCount: resendNumber,
      updatedAt: context.now,
      updatedBy: context.actorId,
    });
    // Venue memory learns the right address, not the wrong one.
    const key = text(requirement.get("venueKey")) || venueKey({ name: requirement.get("venueLegalName") });
    if (key) {
      batch.set(
        db.doc(`venueCoiProfiles/${venueProfileId(context.tenantId, key)}`),
        { submissionEmail: input.submissionEmail, updatedAt: context.now, updatedBy: context.actorId },
        { merge: true },
      );
    }
  }
  batch.create(db.doc(`auditEvents/coi_resend_${input.requestId}_${resendNumber}`), {
    tenantId: context.tenantId,
    projectId: input.projectId,
    actorId: context.actorId,
    actorType: "user",
    action: plan.to === "agent" ? "coi.request_resent" : "coi.venue_resent",
    entityType: "insuranceRequest",
    entityId: input.requestId,
    timestamp: context.now,
    before: {
      status,
      requestEmail: request.get("requestEmail") ?? null,
      submissionEmail: requirement.get("submissionEmail") ?? null,
      ...Object.fromEntries(Object.keys(venueChanges).map((key) => [key, requirement.get(key) ?? null])),
    },
    after: {
      to: plan.to,
      requestEmail: input.agentEmail,
      submissionEmail: input.submissionEmail,
      ...venueChanges,
    },
    ipAddress: null,
    userAgent: null,
    correlationId: `coi_resend_${input.requestId}_${resendNumber}`,
    automationRunId: null,
    providerEventId: null,
  });
  await batch.commit();
  return { requestId: input.requestId, to: plan.to, resendNumber };
}
