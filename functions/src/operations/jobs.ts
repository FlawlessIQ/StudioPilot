import {
  getFirestore,
  type DocumentSnapshot,
} from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  renderEmailTemplate,
  type EmailBrand,
  type EmailTemplateOverride,
} from "../communications/email-templates.js";
import { runAiJob, runPdfJob } from "./ai-pdf.js";
import {
  applyMessageToConversation,
  conversationIdFor,
} from "../communications/conversation.js";
import { replyAddressFor } from "../communications/reply-address.js";
import { captureOperationalError } from "./observability.js";
import { productEvent } from "./product-events.js";
import {
  addCrewCalendarInvite,
  completeBookingResources,
  captureZoomMeetingSummary,
  cancelConsultationResources,
  createConsultationResources,
  createDocusignEnvelope,
  createDropboxSignRequest,
  createQuickBooksInvoice,
  createStripeInvoice,
  rescheduleConsultationResources,
  reconcileQuickBooksInvoice,
  uploadDropboxDocument,
} from "./provider-runtime.js";

type Result = Record<string, unknown>;

export const jobCollections = [
  "providerJobs",
  "emailJobs",
  "aiJobs",
  "pdfJobs",
] as const;

export type JobCollection = (typeof jobCollections)[number];

const retryDelay = (attempt: number) =>
  Math.min(6 * 60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempt - 1));

function retryableJobFailure(
  collectionName: string,
  code: string,
  message: string,
): boolean {
  if (collectionName === "aiJobs") {
    const permanentAiFailures = new Set([
      "STUDIO_IMPORT_DOCX_TEXT_EXTRACTION_FAILED",
      "STUDIO_IMPORT_NO_ASSETS_EXTRACTED",
      "VERTEX_AI_NOT_CONFIGURED",
    ]);
    if (permanentAiFailures.has(code)) return false;
    if (code === "VERTEX_STUDIO_IMPORT_FAILED") {
      const status = Number(message.split(":")[1] ?? 0);
      return status === 408 || status === 429 || status >= 500;
    }
  }
  if (collectionName === "providerJobs") {
    // Provider failures carry their HTTP status: `CODE:402:PROVIDER_ERROR`.
    // A 4xx is the provider refusing, not the network faltering, so retrying
    // only delays the moment anyone finds out — and Today surfaces these
    // jobs at `dead_letter`, never at `retry_scheduled`. A Dropbox Sign 402
    // (the account has no paid API plan) was retried five times over an
    // hour while the contract read "Sent" and nothing had been sent.
    //
    // 408 and 429 are the exceptions: both are the provider asking to be
    // called again later.
    const status = Number(message.split(":")[1] ?? 0);
    if (status >= 400 && status < 500) return status === 408 || status === 429;
    return true;
  }
  if (collectionName !== "emailJobs") return true;
  const permanentEmailFailures = new Set([
    "EMAIL_RECIPIENT_MISSING",
    "SENDGRID_NOT_CONFIGURED",
    "COI_ATTACHMENT_REFERENCE_INVALID",
    "COI_ATTACHMENT_TOO_LARGE",
    "PROPOSAL_ATTACHMENT_INVALID",
    "PROPOSAL_ATTACHMENT_REFERENCE_INVALID",
    "PROPOSAL_ATTACHMENT_TOO_LARGE",
  ]);
  if (permanentEmailFailures.has(code)) return false;
  if (code === "SENDGRID_SEND_FAILED") {
    const status = Number(message.split(":")[1] ?? 0);
    return status === 408 || status === 429 || status >= 500;
  }
  return true;
}

async function claim(document: DocumentSnapshot) {
  return getFirestore().runTransaction(async (transaction) => {
    const current = await transaction.get(document.ref);
    const nextAttemptAt = String(current.get("nextAttemptAt") ?? "");
    if (
      !current.exists ||
      !["queued", "retry_scheduled"].includes(String(current.get("status"))) ||
      (nextAttemptAt && nextAttemptAt > new Date().toISOString())
    ) {
      return false;
    }
    const now = new Date().toISOString();
    transaction.update(document.ref, {
      status: "running",
      attempts: Number(current.get("attempts") ?? 0) + 1,
      startedAt: now,
      updatedAt: now,
    });
    return true;
  });
}

async function finish(
  document: DocumentSnapshot,
  run: () => Promise<Result>,
) {
  if (!(await claim(document))) return;
  try {
    const result = await run();
    const now = new Date().toISOString();
    await document.ref.update({
      status: "succeeded",
      result,
      error: null,
      completedAt: now,
      updatedAt: now,
    });
  } catch (caught: unknown) {
    const current = await document.ref.get();
    const attempts = Number(current.get("attempts") ?? 1);
    const maxAttempts = Number(current.get("maxAttempts") ?? 5);
    const message = caught instanceof Error ? caught.message : "JOB_FAILED";
    const code = message.split(":")[0] ?? "JOB_FAILED";
    const now = new Date().toISOString();
    const retryable =
      attempts < maxAttempts &&
      retryableJobFailure(document.ref.parent.id, code, message);
    await document.ref.update({
      status: retryable ? "retry_scheduled" : "dead_letter",
      error: { code, message, retryable },
      nextAttemptAt: retryable
        ? new Date(Date.now() + retryDelay(attempts)).toISOString()
        : null,
      completedAt: retryable ? null : now,
      updatedAt: now,
    });
    if (
      document.ref.parent.id === "aiJobs" &&
      document.get("type") === "studio_import_extraction" &&
      !retryable
    ) {
      const db = getFirestore();
      const itemId = String(document.get("itemId") ?? "");
      const sessionId = String(document.get("sessionId") ?? "");
      const [item, session] = await Promise.all([
        db.doc(`studioImportItems/${itemId}`).get(),
        db.doc(`studioImportSessions/${sessionId}`).get(),
      ]);
      if (item.exists && session.exists) {
        const itemIds = Array.isArray(session.get("itemIds"))
          ? (session.get("itemIds") as unknown[]).map(String)
          : [];
        const items = await Promise.all(
          itemIds.map((candidateId) =>
            db.doc(`studioImportItems/${candidateId}`).get(),
          ),
        );
        const terminalStatuses = new Set([
          "review_ready",
          "failed",
          "rejected",
          "ignored",
          "cancelled",
        ]);
        const projectedStatuses = items.map((candidate) =>
          candidate.id === itemId ? "failed" : String(candidate.get("status")),
        );
        const analysisFinished = projectedStatuses.every((status) =>
          terminalStatuses.has(status),
        );
        const batch = db.batch();
        batch.update(item.ref, {
          status: "failed",
          failure: { code, message, retryable: false },
          updatedAt: now,
          updatedBy: "studio-import-ai",
        });
        batch.update(session.ref, {
          status: analysisFinished ? "partially_failed" : "processing",
          reviewReadyAt: analysisFinished ? now : null,
          updatedAt: now,
          updatedBy: "studio-import-ai",
        });
        await batch.commit();
      }
    }
    // A contract whose signature request the provider refused is not
    // "queued" waiting for something — it is not going to happen without a
    // person. Say so on the contract, where the studio is looking, rather
    // than only on a job document nothing reads.
    if (
      document.ref.parent.id === "providerJobs" &&
      document.get("contractId") &&
      !retryable
    ) {
      await getFirestore()
        .doc(`contracts/${String(document.get("contractId"))}`)
        .update({
          status: "failed",
          providerState: "failed",
          providerError: { code, message },
          updatedAt: now,
          updatedBy: "provider-worker",
        })
        .catch(() => {
          // The contract may have been removed; the job's own error record
          // is still the authority and must not be lost to this.
        });
    }
    // The same for money. A retainer the accounting provider refused is
    // not "sent" and waiting to be paid — nothing was ever sent. Left
    // saying "sent" the workspace showed a balance outstanding and offered
    // to chase a client for an invoice that does not exist.
    if (
      document.ref.parent.id === "providerJobs" &&
      document.get("invoiceId") &&
      !retryable
    ) {
      await getFirestore()
        .doc(`invoiceReferences/${String(document.get("invoiceId"))}`)
        .update({
          status: "failed",
          providerState: "failed",
          providerError: { code, message },
          updatedAt: now,
          updatedBy: "provider-worker",
        })
        .catch(() => {
          // As above: the job's own error record is the authority and must
          // not be lost to a missing invoice.
        });
    }
    if (
      document.ref.parent.id === "pdfJobs" &&
      document.get("proposalId")
    ) {
      await getFirestore()
        .doc(`proposals/${String(document.get("proposalId"))}`)
        .update({
          pdfState: "failed",
          updatedAt: now,
          updatedBy: "pdf-worker",
        });
    }
    if (
      document.ref.parent.id === "emailJobs" &&
      document.get("proposalId")
    ) {
      await getFirestore()
        .doc(`proposals/${String(document.get("proposalId"))}`)
        .update({
          emailDeliveryStatus: "failed",
          updatedAt: now,
          updatedBy: "email-worker",
        });
    }
    if (document.ref.parent.id === "emailJobs") {
      const failedEvent = productEvent({
        tenantId: String(document.get("tenantId") ?? ""),
        projectId: String(document.get("projectId") ?? "") || null,
        actorId: "email-worker",
        actorType: "system",
        name: "communication.failed",
        occurredAt: now,
        correlationId: `${document.id}:${attempts}`,
        sourceEntityType: "emailJob",
        sourceEntityId: document.id,
        properties: {
          workflowStep: true,
          executionMode: "automatic",
          humanRole: "exception",
          code,
          retryScheduled: retryable,
          attempts,
        },
      });
      await getFirestore()
        .doc(`productEvents/${failedEvent.id}`)
        .set(failedEvent, { merge: false });
    }
    await captureOperationalError(code, {
      collection: document.ref.parent.id,
      jobId: document.id,
      status: retryable ? "retry_scheduled" : "dead_letter",
    });
  }
}

async function providerJob(document: DocumentSnapshot) {
  const type = String(document.get("type"));
  if (type === "capture_zoom_meeting_summary")
    return captureZoomMeetingSummary(document);
  if (type === "create_consultation_resources")
    return createConsultationResources(document);
  if (type === "cancel_consultation_resources")
    return cancelConsultationResources(document);
  if (type === "reschedule_consultation_resources")
    return rescheduleConsultationResources(document);
  if (type === "create_docusign_envelope")
    return createDocusignEnvelope(document);
  if (type === "create_dropbox_sign_request")
    return createDropboxSignRequest(document);
  if (type === "create_quickbooks_invoice")
    return createQuickBooksInvoice(document);
  if (type === "create_stripe_invoice")
    return createStripeInvoice(document);
  if (type === "reconcile_quickbooks_invoice")
    return reconcileQuickBooksInvoice(document);
  if (type === "complete_booking_side_effects")
    return completeBookingResources(document);
  if (type === "upload_dropbox_document")
    return uploadDropboxDocument(document);
  if (type === "add_crew_calendar_invite")
    return addCrewCalendarInvite(document);
  throw new Error("UNSUPPORTED_PROVIDER_JOB");
}

async function recipientFor(document: DocumentSnapshot) {
  const direct = document.get("recipient");
  if (typeof direct === "string" && direct) return direct;
  const projectId = String(document.get("projectId") ?? "");
  if (!projectId) throw new Error("EMAIL_RECIPIENT_MISSING");
  const db = getFirestore();
  const project = await db.doc(`projects/${projectId}`).get();
  const ids = project.get("clientContactIds");
  const contactId = Array.isArray(ids) ? ids[0] : null;
  if (typeof contactId !== "string")
    throw new Error("EMAIL_RECIPIENT_MISSING");
  const contact = await db.doc(`contacts/${contactId}`).get();
  const email = contact.get("email");
  if (typeof email !== "string") throw new Error("EMAIL_RECIPIENT_MISSING");
  return email;
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(
  ...values: ReadonlyArray<unknown>
): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function safeLogoUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function emailTemplateOverride(
  value: unknown,
  tenantId: string,
  templateKey: string,
): EmailTemplateOverride | null {
  const template = objectValue(value);
  const paragraphs = template.paragraphs;
  if (
    (typeof template.tenantId === "string" &&
      template.tenantId !== tenantId) ||
    (typeof template.key === "string" && template.key !== templateKey) ||
    typeof template.subject !== "string" ||
    typeof template.preheader !== "string" ||
    typeof template.eyebrow !== "string" ||
    typeof template.heading !== "string" ||
    !Array.isArray(paragraphs) ||
    !paragraphs.every((paragraph) => typeof paragraph === "string")
  ) {
    return null;
  }
  return {
    subject: template.subject,
    preheader: template.preheader,
    eyebrow: template.eyebrow,
    heading: template.heading,
    paragraphs,
    actionLabel: firstString(template.actionLabel),
    note: firstString(template.note),
  };
}

async function emailContext(
  document: DocumentSnapshot,
  recipient: string,
): Promise<{
  brand: EmailBrand;
  projectName: string | null;
  recipientName: string | null;
  values: Record<string, unknown>;
  template: EmailTemplateOverride | null;
  recipientIsClient: boolean;
}> {
  const db = getFirestore();
  const tenantId = String(document.get("tenantId") ?? "");
  const projectId = String(document.get("projectId") ?? "");
  const [tenant, project] = await Promise.all([
    tenantId && tenantId !== "platform"
      ? db.doc(`tenants/${tenantId}`).get()
      : Promise.resolve(null),
    projectId ? db.doc(`projects/${projectId}`).get() : Promise.resolve(null),
  ]);
  const emailBranding = objectValue(tenant?.get("emailBranding"));
  const brandColors = objectValue(tenant?.get("brandColors"));
  const projectClientIds = project?.get("clientContactIds");
  const contactId = firstString(
    document.get("contactId"),
    Array.isArray(projectClientIds) ? projectClientIds[0] : null,
  );
  const contact = contactId
    ? await db.doc(`contacts/${contactId}`).get()
    : null;
  const clientContactIds = Array.isArray(projectClientIds)
    ? projectClientIds.filter(
        (value): value is string => typeof value === "string" && value !== "",
      )
    : [];
  const clientContacts = clientContactIds.length
    ? await db.getAll(
        ...clientContactIds.map((id) => db.doc(`contacts/${id}`)),
      )
    : [];
  const clientContactEmails = new Set(
    clientContacts
      .map((snapshot) => String(snapshot.get("email") ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  const studioName =
    firstString(
      document.get("brandName"),
      tenant?.get("brandName"),
      tenant?.get("businessName"),
    ) ?? "StudioCue";
  const accentColor =
    firstString(
      document.get("brandAccentColor"),
      emailBranding.primaryColor,
      brandColors.primary,
    ) ?? "#35664a";
  const contactEmail = firstString(
    document.get("replyAddress"),
    emailBranding.replyTo,
    tenant?.get("contactEmail"),
    tenant?.get("email"),
  );
  const recipientName = firstString(
    document.get("recipientName"),
    contact?.get("displayName"),
  );
  const projectName = firstString(
    document.get("projectName"),
    project?.get("name"),
  );
  const templateKey = String(document.get("type") ?? "");
  const snapshotTemplate = emailTemplateOverride(
    document.get("templateSnapshot"),
    tenantId,
    templateKey,
  );
  const templatePointer =
    !snapshotTemplate && tenantId && templateKey
      ? await db.doc(`messageTemplatePointers/${tenantId}_${templateKey}`).get()
      : null;
  const activeTemplateId = firstString(
    templatePointer?.get("activeTemplateId"),
  );
  const activeTemplate = activeTemplateId
    ? await db.doc(`messageTemplates/${activeTemplateId}`).get()
    : null;
  const template =
    snapshotTemplate ??
    (activeTemplate?.exists
      ? emailTemplateOverride(activeTemplate.data(), tenantId, templateKey)
      : null);

  return {
    brand: {
      studioName,
      productName: "StudioCue",
      accentColor,
      logoUrl: safeLogoUrl(
        firstString(
          document.get("brandLogoUrl"),
          emailBranding.logoUrl,
          tenant?.get("logoUrl"),
          tenant?.get("logo"),
        ),
      ),
      contactEmail,
    },
    projectName,
    recipientName,
    template,
    // Compared against every client contact on the project, not just the first:
    // a project with two clients would otherwise misfile mail to the second as
    // studio-only. Falls closed — an unmatched recipient stays studio-visible.
    recipientIsClient: clientContactEmails.has(recipient.trim().toLowerCase()),
    values: {
      ...objectValue(document.data()),
      recipient,
      portalUrl:
        firstString(document.get("portalUrl")) ??
        (projectId
          ? `${process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app"}/client`
          : ""),
    },
  };
}

async function sendEmail(document: DocumentSnapshot): Promise<Result> {
  const recipient = await recipientFor(document);
  const type = String(document.get("type"));
  const projectId = String(document.get("projectId") ?? "");
  const context = await emailContext(document, recipient);
  const rendered = renderEmailTemplate({
    key: type,
    brand: context.brand,
    recipientName: context.recipientName,
    projectName: context.projectName,
    values: context.values,
    template: context.template,
  });

  if (process.env.EMAIL_DELIVERY_MODE !== "live") {
    const messageId = `mock_email_${document.id}`;
    await saveMessage(
      document,
      recipient,
      rendered.subject,
      messageId,
      "mock",
      rendered.text,
      context.recipientIsClient,
      context.recipientName,
      rendered.body,
    );
    if (document.get("proposalId")) {
      await getFirestore()
        .doc(`proposals/${String(document.get("proposalId"))}`)
        .update({
          emailDeliveryStatus: "sent",
          emailMessageId: messageId,
          updatedAt: new Date().toISOString(),
          updatedBy: "email-worker",
        });
    }
    return {
      messageId,
      deliveryMode: "mock",
      templateKey: type,
      branded: true,
    };
  }

  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  if (!apiKey || !fromEmail) throw new Error("SENDGRID_NOT_CONFIGURED");
  const fromName =
    process.env.SENDGRID_FROM_NAME ?? context.brand.studioName;
  const payload: Record<string, unknown> = {
    personalizations: [
      {
        to: [{ email: recipient }],
        custom_args: {
          studioHubJobId: document.id,
          projectId,
          tenantId: String(document.get("tenantId") ?? ""),
          templateKey: type,
        },
      },
    ],
    from: { email: fromEmail, name: fromName },
    subject: rendered.subject,
    content: [
      { type: "text/plain", value: rendered.text },
      { type: "text/html", value: rendered.html },
    ],
    categories: ["studiocue-transactional", type].slice(0, 10),
  };
  // A thread's own reply address takes precedence, so the client's reply comes
  // back into StudioCue instead of the studio's personal inbox. The From line is
  // untouched — the client still sees the studio's name and address; only where
  // a reply goes changes. Returns null unless the inbound domain and signing
  // secret are both configured, so this stays inert until DNS is ready.
  const sendThreadId = threadIdForSend(
    document,
    recipient,
    context.recipientIsClient,
  );
  const threadReplyAddress = sendThreadId
    ? replyAddressFor(sendThreadId)
    : null;
  const replyAddress =
    threadReplyAddress ??
    firstString(document.get("replyAddress"), context.brand.contactEmail);
  // Carry the studio's name on reply_to, not just the address. A per-thread
  // address is necessarily a long signed token, and a client hitting reply saw
  // `reply+Y29udl8wZDhjMj...@inbound.studio-cue.com` sitting in the To field —
  // which looks like machine spam from the studio they just booked. Mail clients
  // show the display name instead when one is present, so they see the studio.
  if (replyAddress) {
    payload.reply_to = { email: replyAddress, name: fromName };
  }
  if (type === "coi_venue_delivery") {
    const documentId = String(document.get("documentId") ?? "");
    const fileDocument = await getFirestore()
      .doc(`documents/${documentId}`)
      .get();
    const reference = String(
      fileDocument.get("cloudStorageSource") ??
        fileDocument.get("providerFileId") ??
        "",
    );
    const match = reference.match(/^gs:\/\/([^/]+)\/(.+)$/);
    const bucketName = match?.[1];
    const objectName = match?.[2];
    if (!bucketName || !objectName)
      throw new Error("COI_ATTACHMENT_REFERENCE_INVALID");
    const [bytes] = await getStorage()
      .bucket(bucketName)
      .file(objectName)
      .download();
    if (bytes.length > 15 * 1024 * 1024)
      throw new Error("COI_ATTACHMENT_TOO_LARGE");
    payload.attachments = [
      {
        content: bytes.toString("base64"),
        type: "application/pdf",
        filename: String(
          fileDocument.get("name") ?? "certificate-of-insurance.pdf",
        ),
        disposition: "attachment",
      },
    ];
  }
  if (type === "proposal_sent" && document.get("attachmentDocumentId")) {
    const attachment = await getFirestore()
      .doc(`documents/${String(document.get("attachmentDocumentId"))}`)
      .get();
    if (
      !attachment.exists ||
      attachment.get("tenantId") !== document.get("tenantId") ||
      attachment.get("projectId") !== document.get("projectId") ||
      attachment.get("contentType") !== "application/pdf"
    ) {
      throw new Error("PROPOSAL_ATTACHMENT_INVALID");
    }
    const objectName = firstString(
      attachment.get("providerFileId"),
      attachment.get("canonicalPath"),
    );
    if (!objectName) throw new Error("PROPOSAL_ATTACHMENT_REFERENCE_INVALID");
    const [bytes] = await getStorage().bucket().file(objectName).download();
    if (bytes.length > 15 * 1024 * 1024) {
      throw new Error("PROPOSAL_ATTACHMENT_TOO_LARGE");
    }
    payload.attachments = [
      {
        content: bytes.toString("base64"),
        type: "application/pdf",
        filename: String(
          attachment.get("name") ?? "photography-proposal.pdf",
        ),
        disposition: "attachment",
      },
    ];
  }
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok)
    throw new Error(`SENDGRID_SEND_FAILED:${response.status}`);
  const messageId =
    response.headers.get("x-message-id") ?? `sendgrid_${document.id}`;
  await saveMessage(
    document,
    recipient,
    rendered.subject,
    messageId,
    "live",
    rendered.text,
    context.recipientIsClient,
    context.recipientName,
    rendered.body,
  );
  const acceptedAt = new Date().toISOString();
  const acceptedEvent = productEvent({
    tenantId: String(document.get("tenantId") ?? ""),
    projectId: projectId || null,
    actorId: "email-worker",
    actorType: "system",
    name: "communication.provider_accepted",
    occurredAt: acceptedAt,
    correlationId: messageId,
    sourceEntityType: "emailJob",
    sourceEntityId: document.id,
    properties: {
      workflowStep: true,
      executionMode: "automatic",
      humanRole: "none",
      provider: "sendgrid",
      templateKey: type,
    },
  });
  await getFirestore()
    .doc(`productEvents/${acceptedEvent.id}`)
    .set(acceptedEvent, { merge: false });
  if (document.get("proposalId")) {
    await getFirestore()
      .doc(`proposals/${String(document.get("proposalId"))}`)
      .update({
        emailDeliveryStatus: "sent",
        emailMessageId: messageId,
        updatedAt: new Date().toISOString(),
        updatedBy: "email-worker",
      });
  }
  if (type === "review_request" && document.get("reviewRequestId")) {
    const now = new Date().toISOString();
    await getFirestore()
      .doc(`reviewRequests/${String(document.get("reviewRequestId"))}`)
      .update({
        status: "sent",
        sentAt: now,
        messageId,
        updatedAt: now,
        updatedBy: "email-worker",
      });
  }
  return { messageId, templateKey: type, branded: true };
}

// Auth mail reaches a client's own address but is not part of the conversation
// they should see replayed in their portal.
const AUTH_EMAIL_TYPES = new Set([
  "password_reset",
  "email_verification",
  "authorization_code",
]);

/**
 * The thread this send belongs to, or null when it is not a client conversation.
 * Both the send path (which needs it to build the reply address) and the record
 * path (which stores it) derive it the same way rather than passing it around.
 */
function threadIdForSend(
  document: DocumentSnapshot,
  recipient: string,
  recipientIsClient: boolean,
): string | null {
  if (!recipientIsClient) return null;
  if (AUTH_EMAIL_TYPES.has(String(document.get("type")))) return null;
  return conversationIdFor({
    tenantId: String(document.get("tenantId") ?? ""),
    projectId: (document.get("projectId") as string | null) ?? null,
    leadId: (document.get("leadId") as string | null) ?? null,
    participant: { email: recipient },
  });
}

async function saveMessage(
  document: DocumentSnapshot,
  recipient: string,
  subject: string,
  messageId: string,
  deliveryMode: "live" | "mock",
  body: string,
  recipientIsClient: boolean,
  recipientName: string | null,
  threadBody: string,
) {
  const now = new Date().toISOString();
  const conversationId = threadIdForSend(
    document,
    recipient,
    recipientIsClient,
  );
  await getFirestore()
    .doc(`messages/${document.id}`)
    .set(
      {
        id: document.id,
        tenantId: document.get("tenantId"),
        projectId: document.get("projectId") ?? null,
        direction: "outbound",
        channel: "email",
        templateKey: document.get("type"),
        recipient,
        subject,
        // Two fields on purpose. `sentText` is the email exactly as delivered,
        // branded wrapper included, because that is the record of what the
        // client received. `body` is the message alone — what a thread bubble
        // and a search should show, without repeating the letterhead inside
        // every letter.
        body: threadBody.slice(0, 40000),
        sentText: body.slice(0, 40000),
        bodyPreview: threadBody.slice(0, 280) || null,
        provider: "sendgrid",
        providerMessageId: messageId,
        deliveryMode,
        deliveryStatus: deliveryMode === "live" ? "sent" : "mock",
        // Everything the studio sends a client belongs in that client's portal.
        // This was flatly "studio", so the portal — which only returns client
        // and shared — showed the client their own messages and none of the
        // replies, and the clientReadAt stamp could never fire. Derived from the
        // recipient rather than a list of template keys so it cannot leak crew,
        // venue, or staff mail as new templates are added.
        visibility:
          recipientIsClient && !AUTH_EMAIL_TYPES.has(String(document.get("type")))
            ? "shared"
            : "studio",
        sentAt: now,
        createdAt: now,
        updatedAt: now,
        createdBy: "email-worker",
        updatedBy: "email-worker",
        archivedAt: null,
        conversationId,
      },
      { merge: true },
    );

  // Threads are client conversations. Crew, venue, and staff mail is real mail
  // but it is not a thread the studio replies within, and giving every
  // assignment email its own conversation would bury the client ones.
  if (conversationId) {
    await applyMessageToConversation(getFirestore(), {
      tenantId: String(document.get("tenantId") ?? ""),
      projectId: (document.get("projectId") as string | null) ?? null,
      leadId: (document.get("leadId") as string | null) ?? null,
      participant: {
        contactId: (document.get("contactId") as string | null) ?? null,
        email: recipient,
        phone: null,
        name: recipientName,
      },
      channel: "email",
      direction: "outbound",
      subject,
      preview: threadBody.slice(0, 240),
      occurredAt: now,
    });
  }
}

async function due(collectionName: string) {
  const db = getFirestore();
  const now = new Date().toISOString();
  const [queued, retries] = await Promise.all([
    db.collection(collectionName).where("status", "==", "queued").limit(20).get(),
    db
      .collection(collectionName)
      .where("status", "==", "retry_scheduled")
      .where("nextAttemptAt", "<=", now)
      .limit(20)
      .get(),
  ]);
  return [...queued.docs, ...retries.docs];
}

export async function processJobDocument(
  collectionName: JobCollection,
  jobId: string,
): Promise<{ claimed: boolean }> {
  const document = await getFirestore()
    .doc(`${collectionName}/${jobId}`)
    .get();
  if (!document.exists) return { claimed: false };
  const before = String(document.get("status") ?? "");
  if (collectionName === "providerJobs")
    await finish(document, () => providerJob(document));
  if (collectionName === "emailJobs")
    await finish(document, () => sendEmail(document));
  if (collectionName === "aiJobs")
    await finish(document, () => runAiJob(document));
  if (collectionName === "pdfJobs")
    await finish(document, () => runPdfJob(document));
  return {
    claimed:
      ["queued", "retry_scheduled"].includes(before) &&
      (String(document.get("nextAttemptAt") ?? "") === "" ||
        String(document.get("nextAttemptAt")) <= new Date().toISOString()),
  };
}

export const operationsJobScheduler = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "UTC",
    retryCount: 0,
    secrets: [
      "SENDGRID_API_KEY",
      "GOOGLE_CALENDAR_CLIENT_SECRET",
      "ZOOM_CLIENT_SECRET",
      "DROPBOX_CLIENT_SECRET",
      "DOCUSIGN_CLIENT_SECRET",
      "DROPBOX_SIGN_CLIENT_SECRET",
      "QUICKBOOKS_CLIENT_ID",
      "QUICKBOOKS_CLIENT_SECRET",
      // Needed to mint each thread's reply address as mail goes out.
      "INBOUND_REPLY_SIGNING_SECRET",
    ],
  },
  async () => {
    for (const collectionName of jobCollections) {
      for (const document of await due(collectionName)) {
        await processJobDocument(collectionName, document.id);
      }
    }
  },
);
