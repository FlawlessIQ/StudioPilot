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
import { captureOperationalError } from "./observability.js";
import {
  addCrewCalendarInvite,
  completeBookingResources,
  createConsultationResources,
  createDocusignEnvelope,
  createDropboxSignRequest,
  createQuickBooksInvoice,
  createStripeInvoice,
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
    await document.ref.update({
      status: attempts >= maxAttempts ? "dead_letter" : "retry_scheduled",
      error: { code, message, retryable: attempts < maxAttempts },
      nextAttemptAt:
        attempts >= maxAttempts
          ? null
          : new Date(Date.now() + retryDelay(attempts)).toISOString(),
      completedAt: attempts >= maxAttempts ? now : null,
      updatedAt: now,
    });
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
    await captureOperationalError(code, {
      collection: document.ref.parent.id,
      jobId: document.id,
      status:
        attempts >= maxAttempts ? "dead_letter" : "retry_scheduled",
    });
  }
}

async function providerJob(document: DocumentSnapshot) {
  const type = String(document.get("type"));
  if (type === "create_consultation_resources")
    return createConsultationResources(document);
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
  const replyAddress =
    firstString(document.get("replyAddress"), context.brand.contactEmail);
  if (replyAddress) payload.reply_to = { email: replyAddress };
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

async function saveMessage(
  document: DocumentSnapshot,
  recipient: string,
  subject: string,
  messageId: string,
  deliveryMode: "live" | "mock",
) {
  const now = new Date().toISOString();
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
        bodyPreview:
          typeof document.get("customBody") === "string"
            ? String(document.get("customBody")).slice(0, 280)
            : null,
        provider: "sendgrid",
        providerMessageId: messageId,
        deliveryMode,
        deliveryStatus: deliveryMode === "live" ? "sent" : "mock",
        visibility: "studio",
        sentAt: now,
        createdAt: now,
        updatedAt: now,
        createdBy: "email-worker",
        updatedBy: "email-worker",
        archivedAt: null,
      },
      { merge: true },
    );
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
      "QUICKBOOKS_CLIENT_ID",
      "QUICKBOOKS_CLIENT_SECRET",
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
