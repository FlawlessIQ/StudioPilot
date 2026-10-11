import { createHash } from "node:crypto";
import { getFirestore, type DocumentSnapshot, type Firestore, type WriteBatch } from "firebase-admin/firestore";
import {
  QUICKBOOKS_ONLINE_PAYMENT_FLAGS,
  connection,
  mockId,
  providerJson,
  quickBooksInvoiceLink,
  quickBooksItemRef,
  quickBooksPreferences,
  type Credential,
} from "../operations/provider-runtime.js";
import { quickBooksApiBaseUrl } from "../integrations/provider-config.js";
import { quickBooksTaxMode } from "../operations/quickbooks-invoice-lines.js";
import {
  RECONCILE_PARTICIPANT_INVOICE_JOB,
  participantCustomerBody,
  participantCustomerNames,
  participantInvoiceLines,
  participantInvoiceStanding,
  participantInvoiceVoidJob,
  type ParticipantInvoiceState,
} from "./participant-invoice-core.js";

/**
 * A QuickBooks invoice for each parent at a group event — the QuickBooks
 * calls (docs/group-event-signup-plan-2026-10-10.md, Phase 4b). The pure
 * part, and why these never enter `invoiceReferences`, is in
 * participant-invoice-core.ts.
 *
 * The parent is the customer, not the job's client (the organiser). The
 * invoice carries one line, no tax. StudioCue emails the parent its pay
 * link, as it does for a couple's invoice; a company with no online payment
 * has no link to give, so QuickBooks sends that one itself.
 */

type Json = Record<string, unknown>;
const asRecord = (value: unknown): Json => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {});
const text = (value: unknown) => (typeof value === "string" ? value : "");
const cents = (value: unknown) => Math.max(0, Math.round(Number(value ?? 0) * 100));
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
const money = (amountCents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amountCents / 100);

/** A connected QuickBooks company, as these calls need it. */
export type Company = { base: string; realmId: string; credential: Credential };

async function company(tenantId: string, realmHint?: string): Promise<Company | "mock"> {
  const provider = await connection(tenantId, "quickbooks");
  if (provider.mock) return "mock";
  const credential = provider.credential;
  const realmId = credential?.realmId ?? (realmHint || String(provider.document.get("providerAccountId") ?? ""));
  if (!credential || !realmId) throw new Error("QUICKBOOKS_REALM_MISSING");
  return { base: quickBooksApiBaseUrl(credential.baseUrl), realmId, credential };
}

const companyUrl = (c: Company, path: string) =>
  `${c.base}/v3/company/${encodeURIComponent(c.realmId)}/${path}${path.includes("?") ? "&" : "?"}minorversion=75`;
const headers = (c: Company, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${c.credential.accessToken}`,
  accept: "application/json",
  ...extra,
});

/**
 * The parent's QuickBooks customer: one with their email, else one with
 * their name and no other email, else a new one — named apart, with their
 * email, when the name belongs to someone else.
 */
export async function parentCustomerId(
  c: Company,
  parent: { parentName: string; email: string; phone: string | null },
  requestId: string,
): Promise<string> {
  const query = async (sql: string) =>
    asRecord(
      (await providerJson(companyUrl(c, `query?query=${encodeURIComponent(sql)}`), { headers: headers(c) }, "QUICKBOOKS_CUSTOMER_SEARCH_FAILED"))
        .QueryResponse,
    ).Customer as unknown[] | undefined;
  const email = parent.email.replaceAll("'", "\\'");
  const byEmail = asRecord((await query(`select * from Customer where PrimaryEmailAddr = '${email}' maxresults 1`))?.[0]);
  if (text(byEmail.Id)) return text(byEmail.Id);
  const [name, apart] = participantCustomerNames(parent.parentName, parent.email);
  const byName = asRecord((await query(`select * from Customer where DisplayName = '${name.replaceAll("'", "\\'")}' maxresults 1`))?.[0]);
  const theirEmail = text(asRecord(byName.PrimaryEmailAddr).Address).toLowerCase();
  if (text(byName.Id) && (!theirEmail || theirEmail === parent.email.toLowerCase())) return text(byName.Id);
  const create = (displayName: string, suffix: string) =>
    providerJson(
      companyUrl(c, "customer"),
      {
        method: "POST",
        headers: headers(c, { "content-type": "application/json", "request-id": `${requestId}-c${suffix}`.slice(0, 50) }),
        body: JSON.stringify(participantCustomerBody({ displayName, parentName: parent.parentName, email: parent.email, phone: parent.phone })),
      },
      "QUICKBOOKS_CUSTOMER_CREATE_FAILED",
    );
  let created: Json;
  try {
    // Their name is taken by someone with a different email: name them apart.
    created = await create(text(byName.Id) ? apart : name, "");
  } catch (caught) {
    if (!(caught instanceof Error && /already exists/i.test(caught.message))) throw caught;
    created = await create(apart, "2");
  }
  const id = text(asRecord(created.Customer).Id);
  if (!id) throw new Error("QUICKBOOKS_CUSTOMER_ID_MISSING");
  return id;
}

function participantReference(db: Firestore, job: DocumentSnapshot) {
  return db.doc(`eventParticipants/${String(job.get("participantId") ?? "")}`);
}

async function loadParticipant(db: Firestore, job: DocumentSnapshot) {
  const participant = await participantReference(db, job).get();
  if (!participant.exists || participant.get("tenantId") !== job.get("tenantId")) throw new Error("PARTICIPANT_NOT_FOUND");
  return participant;
}

/** Merge into `qbInvoice`, leaving the rest of it as it was. */
function invoicePatch(fields: Json, now: string): Json {
  return Object.fromEntries([
    ...Object.entries(fields).map(([key, value]) => [`qbInvoice.${key}`, value]),
    ["qbInvoice.updatedAt", now],
    ["updatedAt", now],
  ]);
}

/** The parent's email with the pay link: once per invoice. */
function invoiceEmail(input: {
  participant: DocumentSnapshot;
  projectId: string;
  providerInvoiceId: string;
  payUrl: string | null;
  now: string;
  eventDate: unknown;
}) {
  const { participant } = input;
  const orderToken = text(participant.get("orderToken"));
  const id = `participant_invoice_${createHash("sha256").update(`${participant.id}:${input.providerInvoiceId}`).digest("hex").slice(0, 32)}`;
  return {
    id,
    data: {
      id,
      tenantId: participant.get("tenantId"),
      projectId: input.projectId,
      participantId: participant.id,
      type: "group_participant_invoice",
      recipient: text(participant.get("email")),
      recipientName: participant.get("parentName") ?? null,
      // The parent alone: the job's client is the organiser.
      soleRecipient: true,
      audience: "parent",
      athleteName: participant.get("athleteName") ?? null,
      packageName: participant.get("packageName") ?? null,
      amountText: money(Number(participant.get("amountCents") ?? 0)),
      eventDate: input.eventDate ?? null,
      payUrl: input.payUrl,
      actionUrl: orderToken ? `${appUrl()}/e/order/${orderToken}` : null,
      status: "queued",
      attempts: 0,
      maxAttempts: 5,
      createdAt: input.now,
      updatedAt: input.now,
    },
  };
}

/**
 * Make a parent's invoice in QuickBooks: one line, no tax, their email as
 * BillEmail (QuickBooks issues a pay link only with one), online payment
 * asked for. A refused request made nothing, so asking again cannot
 * duplicate: first without online payment, then without tax codes.
 */
export async function createParentInvoiceAt(
  c: Company,
  input: {
    customerId: string;
    email: string;
    participantId: string;
    amountCents: number;
    athleteName: string;
    packageName: string | null;
    eventName: string | null;
    requestId: string;
  },
): Promise<Json> {
  const preferences = await quickBooksPreferences(c.base, c.realmId, c.credential);
  const taxable = quickBooksTaxMode(preferences) === "none" ? "none" : "codes";
  const itemRef = await quickBooksItemRef(c.base, c.realmId, c.credential, input.requestId);
  const create = (online: boolean, codes: "none" | "codes", suffix: string) =>
    providerJson(
      companyUrl(c, "invoice"),
      {
        method: "POST",
        headers: headers(c, { "content-type": "application/json", "request-id": `${input.requestId}${suffix}`.slice(0, 50) }),
        body: JSON.stringify({
          CustomerRef: { value: input.customerId },
          PrivateNote: `StudioCue group event · ${input.participantId}`,
          BillEmail: { Address: input.email },
          EmailStatus: "NotSet",
          ...(online ? QUICKBOOKS_ONLINE_PAYMENT_FLAGS : {}),
          Line: participantInvoiceLines({
            amountCents: input.amountCents,
            athleteName: input.athleteName,
            packageName: input.packageName,
            eventName: input.eventName,
            itemRef,
            taxable: codes,
          }),
        }),
      },
      "QUICKBOOKS_CREATE_FAILED",
    );
  const refused = (error: unknown) => String((error as Error)?.message ?? "").startsWith("QUICKBOOKS_CREATE_FAILED:400:");
  const value = await create(true, taxable, "")
    .catch((error: unknown) => {
      if (refused(error)) return create(false, taxable, "o");
      throw error;
    })
    .catch((error: unknown) => {
      if (refused(error) && taxable === "codes") return create(false, "none", "p");
      throw error;
    });
  return asRecord(value.Invoice);
}

/** What QuickBooks holds for an invoice now. */
export async function readParentInvoiceAt(c: Company, providerInvoiceId: string): Promise<Json> {
  return asRecord(
    (await providerJson(companyUrl(c, `invoice/${encodeURIComponent(providerInvoiceId)}`), { headers: headers(c) }, "QUICKBOOKS_INVOICE_READ_FAILED")).Invoice,
  );
}

/**
 * Withdraw a parent's invoice in QuickBooks. Already void is success; money
 * taken there is a refusal — voiding would unapply a real payment, which is
 * the studio's call, in QuickBooks.
 */
export async function voidParentInvoiceAt(c: Company, providerInvoiceId: string, requestId: string): Promise<"voided" | "already_void"> {
  const found = await readParentInvoiceAt(c, providerInvoiceId);
  const total = cents(found.TotalAmt);
  const balance = cents(found.Balance);
  if (total === 0 && balance === 0) return "already_void";
  if (balance < total) throw new Error(`QUICKBOOKS_INVOICE_HAS_PAYMENT:409:QuickBooks shows a payment of ${((total - balance) / 100).toFixed(2)} on this invoice`);
  await providerJson(
    companyUrl(c, "invoice?operation=void"),
    {
      method: "POST",
      headers: headers(c, { "content-type": "application/json", "request-id": requestId.slice(0, 50) }),
      body: JSON.stringify({ Id: providerInvoiceId, SyncToken: String(found.SyncToken ?? "0") }),
    },
    "QUICKBOOKS_VOID_FAILED",
  );
  return "voided";
}

export async function createQuickBooksParticipantInvoice(job: DocumentSnapshot) {
  const db = getFirestore();
  const tenantId = String(job.get("tenantId"));
  const participant = await loadParticipant(db, job);
  const reference = participant.ref;
  const invoice = asRecord(participant.get("qbInvoice"));
  const attempt = Number(job.get("attempt") ?? invoice.attempt ?? 1);
  const now = () => new Date().toISOString();
  // A newer attempt replaced this job: nothing to do here.
  if (Number(invoice.attempt ?? attempt) !== attempt) return { participantId: participant.id, skipped: "superseded" };
  if (["open", "partially_paid", "paid"].includes(text(invoice.state)) && text(invoice.providerInvoiceId))
    return { participantId: participant.id, providerInvoiceId: text(invoice.providerInvoiceId), already: true };
  // Paid another way, or cancelled, before the invoice was made.
  if (participant.get("status") === "paid" || participant.get("status") === "cancelled") {
    await reference.update(invoicePatch({ state: "skipped" satisfies ParticipantInvoiceState }, now()));
    return { participantId: participant.id, skipped: participant.get("status") };
  }
  const email = text(participant.get("email"));
  if (!email) throw new Error("PARTICIPANT_EMAIL_REQUIRED:400:A QuickBooks invoice needs the parent's email");
  const amountCents = Number(participant.get("amountCents") ?? 0);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("PARTICIPANT_AMOUNT_REQUIRED:400:The parent owes nothing to invoice");
  const projectId = String(participant.get("projectId"));
  const project = await db.doc(`projects/${projectId}`).get();
  const requestId = String(job.get("idempotencyKey") ?? job.id);

  const link = await company(tenantId);
  let providerInvoiceId = text(invoice.providerInvoiceId);
  let providerCustomerId = text(invoice.providerCustomerId);
  let totalCents = amountCents;
  let balanceCents = amountCents;
  let docNumber: string | null = null;
  let hostedUrl: string | null = null;
  let deliveredBy: "studiocue" | "quickbooks" | "mock" = "studiocue";

  if (link === "mock") {
    providerInvoiceId = providerInvoiceId || mockId("qbo_participant_invoice", requestId);
    providerCustomerId = providerCustomerId || mockId("qbo_customer", email);
    deliveredBy = "mock";
  } else {
    // An earlier attempt that made the invoice and then fell over: adopt it,
    // never make a second.
    let adopted: Json | null = null;
    if (providerInvoiceId) {
      adopted = await readParentInvoiceAt(link, providerInvoiceId);
    }
    if (!adopted || !text(adopted.Id)) {
      providerCustomerId = providerCustomerId || (await parentCustomerId(link, { parentName: text(participant.get("parentName")), email, phone: text(participant.get("phone")) || null }, requestId));
      const value = await createParentInvoiceAt(link, {
        customerId: providerCustomerId,
        email,
        participantId: participant.id,
        amountCents,
        athleteName: text(participant.get("athleteName")),
        packageName: text(participant.get("packageName")) || null,
        eventName: text(project.get("name")) || null,
        requestId,
      });
      adopted = value;
      providerInvoiceId = text(adopted.Id);
      if (!providerInvoiceId) throw new Error("QUICKBOOKS_INVOICE_ID_MISSING");
      // Kept the moment it exists, so a retry adopts it rather than billing twice.
      await reference.update(invoicePatch({ providerInvoiceId, providerCustomerId }, now()));
    }
    totalCents = cents(adopted.TotalAmt);
    balanceCents = cents(adopted.Balance);
    docNumber = text(adopted.DocNumber) || null;
    hostedUrl = await quickBooksInvoiceLink(link.base, link.realmId, link.credential, providerInvoiceId);
    if (!hostedUrl) {
      // No online payment on this company: QuickBooks emails the invoice
      // itself, with whatever payment instructions the studio keeps there.
      await providerJson(
        companyUrl(link, `invoice/${encodeURIComponent(providerInvoiceId)}/send?sendTo=${encodeURIComponent(email)}`),
        { method: "POST", headers: headers(link, { "content-type": "application/octet-stream" }) },
        "QUICKBOOKS_SEND_FAILED",
      );
      deliveredBy = "quickbooks";
    }
  }

  // Paid in cash or cancelled while QuickBooks was being asked: withdraw the
  // bill now rather than email it.
  const latest = await reference.get();
  if (latest.get("status") === "paid" || latest.get("status") === "cancelled") {
    await reference.update(invoicePatch({ providerInvoiceId, providerCustomerId, state: "void_queued" }, now()));
    await queueParticipantInvoiceVoid(db, latest, now());
    return { participantId: participant.id, providerInvoiceId, withdrawn: latest.get("status") };
  }

  const at = now();
  const batch = db.batch();
  batch.update(
    reference,
    invoicePatch(
      {
        state: participantInvoiceStanding({ totalCents, balanceCents }) satisfies ParticipantInvoiceState,
        providerInvoiceId,
        providerCustomerId,
        docNumber,
        hostedUrl,
        totalCents,
        balanceCents,
        deliveredBy,
        error: null,
      },
      at,
    ),
  );
  if (deliveredBy !== "quickbooks") {
    const message = invoiceEmail({ participant: latest, projectId, providerInvoiceId, payUrl: hostedUrl, now: at, eventDate: project.get("eventDate") });
    const emailReference = db.doc(`emailJobs/${message.id}`);
    if (!(await emailReference.get()).exists) batch.create(emailReference, message.data);
  }
  await batch.commit();
  return { participantId: participant.id, providerInvoiceId, hostedUrl, deliveredBy };
}

/** The void a parent's invoice needs once they paid another way or were cancelled. */
export async function queueParticipantInvoiceVoid(db: Firestore, participant: DocumentSnapshot, now: string) {
  const providerInvoiceId = text(asRecord(participant.get("qbInvoice")).providerInvoiceId);
  if (!providerInvoiceId) return null;
  const job = participantInvoiceVoidJob({
    participantId: participant.id,
    tenantId: String(participant.get("tenantId")),
    projectId: participant.get("projectId") ?? null,
    providerInvoiceId,
    now,
  });
  await db.doc(`providerJobs/${job.id}`).set(job.data, { merge: true });
  return job.id;
}

export async function voidQuickBooksParticipantInvoice(job: DocumentSnapshot) {
  const db = getFirestore();
  const participant = await loadParticipant(db, job);
  const providerInvoiceId = text(job.get("providerInvoiceId"));
  const now = new Date().toISOString();
  const done = async (outcome: string) => {
    // Only the invoice this job was about: a newer one stays as it is.
    if (text(asRecord(participant.get("qbInvoice")).providerInvoiceId) === providerInvoiceId)
      await participant.ref.update(invoicePatch({ state: "voided" satisfies ParticipantInvoiceState, balanceCents: 0 }, now));
    return { participantId: participant.id, providerInvoiceId, voided: outcome };
  };
  const link = await company(String(job.get("tenantId")));
  if (link === "mock") return done("mock");
  return done(await voidParentInvoiceAt(link, providerInvoiceId, String(job.get("idempotencyKey") ?? job.id)));
}

/**
 * What QuickBooks says about a parent's invoice, on the parent's record.
 *
 * Paid there marks the parent paid (online) and emails their receipt — the
 * studio did nothing, so nobody else would. A payment the studio recorded
 * itself is never undone by this; a payment QuickBooks itself recorded and
 * then lost (a deleted payment) puts the parent back to owing.
 */
export async function reconcileQuickBooksParticipantInvoice(job: DocumentSnapshot) {
  const db = getFirestore();
  const participant = await loadParticipant(db, job);
  const invoice = asRecord(participant.get("qbInvoice"));
  const providerInvoiceId = text(job.get("providerInvoiceId")) || text(invoice.providerInvoiceId);
  // An invoice the parent no longer holds (a newer one replaced it).
  if (!providerInvoiceId || providerInvoiceId !== text(invoice.providerInvoiceId))
    return { participantId: participant.id, skipped: "not_current" };
  let totalCents = Number(invoice.totalCents ?? participant.get("amountCents") ?? 0);
  let balanceCents = Number(invoice.balanceCents ?? totalCents);
  const operation = text(job.get("operation"));
  const link = await company(String(job.get("tenantId")), text(job.get("realmId")));
  if (link !== "mock" && !["delete", "deleted", "void", "voided"].includes(operation.toLowerCase())) {
    const current = await readParentInvoiceAt(link, providerInvoiceId);
    totalCents = cents(current.TotalAmt);
    balanceCents = cents(current.Balance);
  }
  const state = participantInvoiceStanding({ operation, totalCents, balanceCents });
  const now = new Date().toISOString();
  const batch = db.batch();
  const update: Json = invoicePatch({ state, totalCents, balanceCents }, now);
  const payment = asRecord(participant.get("payment"));
  const paidByQuickBooks = participant.get("status") === "paid" && payment.recordedBy === "quickbooks";
  if (state === "paid" && participant.get("status") !== "paid" && participant.get("status") !== "cancelled") {
    update.status = "paid";
    update.payment = { amountCents: totalCents, method: "online", paidAt: now, recordedBy: "quickbooks" };
    update.receiptQueuedAt = text(participant.get("email")) ? now : null;
    const email = text(participant.get("email"));
    if (email) {
      const receiptId = `participant_receipt_${participant.id}`;
      const receipt = db.doc(`emailJobs/${receiptId}`);
      if (!(await receipt.get()).exists) {
        const orderToken = text(participant.get("orderToken"));
        batch.create(receipt, {
          id: receiptId,
          tenantId: participant.get("tenantId"),
          projectId: participant.get("projectId"),
          participantId: participant.id,
          type: "participant_receipt",
          recipient: email,
          recipientName: participant.get("parentName") ?? null,
          soleRecipient: true,
          audience: "parent",
          ...(orderToken ? { actionUrl: `${appUrl()}/e/order/${orderToken}` } : {}),
          athleteName: participant.get("athleteName") ?? null,
          packageName: participant.get("packageName") ?? null,
          amountText: money(totalCents),
          methodText: "online",
          status: "queued",
          attempts: 0,
          maxAttempts: 5,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    const auditId = createHash("sha256").update(`participant-paid-qbo:${job.id}`).digest("hex").slice(0, 32);
    batch.set(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId: participant.get("tenantId"),
      projectId: participant.get("projectId"),
      actorId: "quickbooks",
      actorType: "system",
      action: "participant.paid",
      entityType: "eventParticipant",
      entityId: participant.id,
      timestamp: now,
      before: { status: participant.get("status") },
      after: { status: "paid", amountCents: totalCents, method: "online" },
      ipAddress: null,
      userAgent: null,
      correlationId: job.id,
      automationRunId: null,
      providerEventId: text(job.get("idempotencyKey")) || null,
    });
  } else if (state !== "paid" && paidByQuickBooks) {
    // QuickBooks took back the payment it reported: they owe again.
    update.status = "unpaid";
    update.payment = null;
    update["qbInvoice.reopenedAt"] = now;
  }
  batch.update(participant.ref, update);
  const webhookEventId = text(job.get("webhookEventId"));
  if (webhookEventId) batch.update(db.doc(`webhookEvents/${webhookEventId}`), { status: "processed", processedAt: now });
  await batch.commit();
  return { participantId: participant.id, providerInvoiceId, state, balanceCents };
}

/**
 * Parents' invoices that a QuickBooks event touches, each queued to be read
 * again. Used by the webhook (an Invoice event) and the money-event worker
 * (a Payment or credit memo applied to one).
 */
export async function queueParticipantInvoiceReconciles(input: {
  db: Firestore;
  batch: WriteBatch;
  tenantId: string;
  providerInvoiceIds: string[];
  eventKey: string;
  realmId: string;
  operation: string;
  occurredAt: string;
  webhookEventId?: string;
  now: string;
}): Promise<string[]> {
  const queued: string[] = [];
  for (const providerInvoiceId of [...new Set(input.providerInvoiceIds)].slice(0, 100)) {
    const found = await input.db
      .collection("eventParticipants")
      .where("tenantId", "==", input.tenantId)
      .where("qbInvoice.providerInvoiceId", "==", providerInvoiceId)
      .limit(5)
      .get();
    for (const participant of found.docs) {
      const key = `${input.eventKey}:${participant.id}`;
      const id = `participant_reconcile_${createHash("sha256").update(key).digest("hex")}`;
      input.batch.set(
        input.db.doc(`providerJobs/${id}`),
        {
          id,
          tenantId: input.tenantId,
          projectId: participant.get("projectId") ?? null,
          participantId: participant.id,
          providerInvoiceId,
          realmId: input.realmId,
          operation: input.operation,
          occurredAt: input.occurredAt,
          webhookEventId: input.webhookEventId ?? "",
          type: RECONCILE_PARTICIPANT_INVOICE_JOB,
          idempotencyKey: key,
          status: "queued",
          attempts: 0,
          createdAt: input.now,
          updatedAt: input.now,
        },
        { merge: true },
      );
      queued.push(participant.id);
    }
  }
  return queued;
}

/** QuickBooks refused to make the invoice, for good: the studio sees it and can send again. */
export async function participantInvoiceFailed(job: DocumentSnapshot, error: { code: string; message: string }) {
  const db = getFirestore();
  const reference = participantReference(db, job);
  const participant = await reference.get();
  if (!participant.exists) return;
  const invoice = asRecord(participant.get("qbInvoice"));
  if (Number(invoice.attempt ?? 1) !== Number(job.get("attempt") ?? invoice.attempt ?? 1)) return;
  if (["open", "partially_paid", "paid", "voided"].includes(text(invoice.state))) return;
  await reference.update(invoicePatch({ state: "failed" satisfies ParticipantInvoiceState, error }, new Date().toISOString()));
}
