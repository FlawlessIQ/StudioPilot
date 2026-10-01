import { createHash } from "node:crypto";
import { getFirestore, type DocumentReference, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { quickBooksApiBaseUrl } from "../integrations/provider-config.js";
import {
  quickBooksCompany,
  studioCueInvoiceItemRefs,
  type ItemRef,
  type QuickBooksCompany,
  type QuickBooksRequest,
} from "../integrations/quickbooks-items.js";
import { invoiceClosedToProviderWork } from "../booking/invoice-standing.js";
import {
  quickBooksBillAddr,
  quickBooksTaxMode,
  type BillingAddress,
  type QuickBooksTaxMode,
} from "./quickbooks-invoice-lines.js";
import type { QuickBooksInvoicePlan } from "./quickbooks-invoice-plan.js";
import {
  chooseQuickBooksTaxStrategy,
  mockTaxReadBack,
  quickBooksDefaultTaxCode,
  quickBooksGatedPayload,
  quickBooksInvoiceStillTaxed,
  quickBooksLinesAsSent,
  quickBooksLinesWithoutTax,
  quickBooksSalesTaxCodes,
  quickBooksSparseInvoiceUpdate,
  quickBooksTaxReadBack,
  sendReviewRecord,
  taxStrategyFromRecord,
  type GatedPayload,
  type HoldReason,
  type QuickBooksTaxCode,
  type QuickBooksTaxStrategy,
  type TaxReadBack,
} from "./quickbooks-final-tax.js";

/**
 * The QuickBooks side of "QuickBooks is the sales-tax authority".
 *
 * Two workers, both for a studio switched on to itemised invoices
 * (tenantFeatures.quickbooksItemisedInvoices):
 *
 * - createGatedQuickBooksInvoice — the create job's gated path. The invoice
 *   is made in QuickBooks with pre-tax lines and no tax override, QuickBooks'
 *   tax is read back, and the record takes QuickBooks' figures. A final (and
 *   a retainer, when the studio asked) is then **held**: status
 *   `review_required`, a `sendReview` on the record, no pay link stored and
 *   no email. QuickBooks itself never emails it — StudioCue never calls
 *   /send, and the invoice is created with EmailStatus left NotSet.
 *
 * - actOnHeldQuickBooksInvoice — the job behind the studio's choice
 *   (bookingCommand sendHeldInvoice): send with tax, send without tax (a
 *   sparse update making every line non-taxable, read back, then sent), or
 *   work the tax out again once the couple's billing address is on record.
 *
 * The decisions are pure, in quickbooks-final-tax.ts. provider-runtime.ts
 * hands these workers its own helpers (`HeldInvoiceDeps`) so this module
 * never imports the runtime, and the runtime's pre-switch path is untouched.
 */

type Row = Record<string, unknown>;

const record = (value: unknown): Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const cents = (value: unknown): number => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number) : 0;
};

/** The job type the sendHeldInvoice command queues. */
export const HELD_INVOICE_JOB_TYPE = "release_quickbooks_invoice";

export type HeldInvoiceAction = "send_with_tax" | "send_without_tax" | "recalculate";

type Credential = { accessToken: string; baseUrl?: string; realmId?: string };

type ProviderConnection = { mock: boolean; credential: Credential | null; document: DocumentSnapshot };

/** What provider-runtime lends these workers. */
export type HeldInvoiceDeps = {
  connection(tenantId: string): Promise<ProviderConnection>;
  request: QuickBooksRequest;
  mockId(scope: string, id: string): string;
  docNumber(invoiceId: string): string;
  onlinePaymentFlags: Record<string, unknown>;
  customerId(
    tenantId: string,
    projectId: string,
    invoice: DocumentSnapshot,
    credential: Credential,
    realmId: string,
    idempotencyKey: string,
  ): Promise<string>;
  fallbackItemRef(base: string, realmId: string, credential: Credential, idempotencyKey: string): Promise<ItemRef>;
  invoiceLink(base: string, realmId: string, credential: Credential, providerInvoiceId: string): Promise<string | null>;
  enqueueInvoiceEmail(input: {
    db: Firestore;
    tenantId: string;
    projectId: string;
    invoiceId: string;
    invoiceUrl: string | null;
    email: string;
    kind?: string;
  }): Promise<{ alreadyDelivered: boolean }>;
  clientEmailFor(db: Firestore, tenantId: string, projectId: string): Promise<string>;
  landProviderInvoice(
    reference: DocumentReference,
    fields: Record<string, unknown>,
    owed: { status: string; balanceCents?: number },
  ): Promise<{ closedMeanwhile: boolean }>;
  skipClosedInvoice(reference: DocumentReference, invoice: DocumentSnapshot, job: DocumentSnapshot): Promise<Record<string, unknown>>;
};

/** The couple's billing address, from the first client contact that has one. */
export async function coupleBillingAddress(db: Firestore, tenantId: string, projectId: string): Promise<BillingAddress | null> {
  const project = await db.doc(`projects/${projectId}`).get();
  if (!project.exists || project.get("tenantId") !== tenantId) return null;
  const ids = Array.isArray(project.get("clientContactIds")) ? (project.get("clientContactIds") as unknown[]) : [];
  for (const id of ids) {
    if (typeof id !== "string" || !id) continue;
    const contact = await db.doc(`contacts/${id}`).get();
    if (!contact.exists || contact.get("tenantId") !== tenantId) continue;
    const address = record(contact.get("billingAddress"));
    if (quickBooksBillAddr(address as BillingAddress)) return address as BillingAddress;
  }
  return null;
}

/** QuickBooks wants a Request-Id it can dedupe on; keep the suffix that makes each retry distinct. */
const requestId = (key: string, suffix: string) =>
  `${key.length > 40 ? createHash("sha256").update(key).digest("hex").slice(0, 40) : key}${suffix}`;

const refusedCreate = (caught: unknown) =>
  String((caught as Error)?.message ?? "").startsWith("QUICKBOOKS_CREATE_FAILED:400:");

async function readInvoice(company: QuickBooksCompany, id: string): Promise<Row | null> {
  if (!id || /^(pending_|qbo_invoice_)/.test(id)) return null;
  try {
    const found = record((await company.get(`invoice/${encodeURIComponent(id)}`, "QUICKBOOKS_INVOICE_READ_FAILED")).Invoice);
    return text(found.Id) ? found : null;
  } catch {
    // Stale or from another company file: falling through to a create is
    // safer than failing the job over a read.
    return null;
  }
}

async function findByDocNumber(company: QuickBooksCompany, docNumber: string): Promise<Row | null> {
  try {
    const escaped = docNumber.split("'").join("\\'");
    const found = record(
      record(await company.query(`select * from Invoice where DocNumber = '${escaped}' maxresults 1`, "QUICKBOOKS_INVOICE_SEARCH_FAILED"))
        .QueryResponse,
    ).Invoice;
    const first = Array.isArray(found) ? record(found[0]) : {};
    return text(first.Id) ? first : null;
  } catch {
    return null;
  }
}

/** How the company does sales tax, and the codes a manual company might use. */
async function companyTax(
  company: QuickBooksCompany,
  taxApplies: boolean,
): Promise<{ preferences: Row | null; mode: QuickBooksTaxMode; defaultCode: QuickBooksTaxCode | null; codes: QuickBooksTaxCode[] }> {
  const preferences = await company
    .get("preferences", "QUICKBOOKS_PREFERENCES_FAILED")
    .then((value) => {
      const prefs = record(value.Preferences);
      return Object.keys(prefs).length ? prefs : null;
    })
    .catch(() => null);
  const mode = quickBooksTaxMode(preferences);
  const defaultCode = quickBooksDefaultTaxCode(preferences);
  // Only a manual company with no default code needs the list; a failed read
  // is "no codes", which falls back to the studio's estimate.
  const codes =
    taxApplies && mode === "manual" && !defaultCode
      ? await company
          .query("select * from TaxCode maxresults 100", "QUICKBOOKS_TAX_CODE_SEARCH_FAILED")
          .then(quickBooksSalesTaxCodes)
          .catch(() => [])
      : [];
  return { preferences, mode, defaultCode, codes };
}

/**
 * The gated create. Called by createQuickBooksInvoice (provider-runtime.ts)
 * after its own guards, for a plan carrying `gated`.
 */
export async function createGatedQuickBooksInvoice(input: {
  job: DocumentSnapshot;
  invoice: DocumentSnapshot;
  plan: QuickBooksInvoicePlan;
  provider: ProviderConnection;
  deps: HeldInvoiceDeps;
}) {
  const { job, invoice, plan, provider, deps } = input;
  const gated = plan.gated!;
  const db = getFirestore();
  const invoiceId = invoice.id;
  const tenantId = text(job.get("tenantId"));
  const projectId = text(invoice.get("projectId"));
  const key = text(job.get("idempotencyKey")) || job.id;
  const kind = text(invoice.get("kind"));
  let providerInvoiceId = "";
  let providerCustomerId = text(invoice.get("providerCustomerId"));
  let docNumber: string | null = null;
  let companyMode: QuickBooksTaxMode = "none";
  let strategy: QuickBooksTaxStrategy;
  let payload: GatedPayload;
  let readBack: TaxReadBack;
  let hostedUrl: string | null = null;
  let alreadyDelivered = false;
  const hold: HoldReason | null = gated.holdReason;

  if (provider.mock) {
    providerInvoiceId = deps.mockId("qbo_invoice", job.id);
    providerCustomerId = providerCustomerId.startsWith("pending_") ? deps.mockId("qbo_customer", projectId) : providerCustomerId;
    strategy = gated.taxApplies ? { kind: "automated" } : { kind: "none" };
    companyMode = "automated";
    payload = quickBooksGatedPayload({ lines: plan.lines, strategy, companyMode, itemRef: { value: "mock" } });
    readBack = mockTaxReadBack({
      lines: plan.lines,
      taxApplies: gated.taxApplies,
      estimateRateBasisPoints: gated.estimateRateBasisPoints,
      billingAddressKnown: Boolean(await coupleBillingAddress(db, tenantId, projectId)),
    });
  } else {
    const credential = provider.credential;
    const realmId = credential?.realmId ?? text(provider.document.get("providerAccountId"));
    if (!credential || !realmId) throw new Error("QUICKBOOKS_REALM_MISSING");
    // Finds or makes the couple in QuickBooks and fills its blanks — the
    // billing address included, which is what Automated Sales Tax reads.
    providerCustomerId = await deps.customerId(tenantId, projectId, invoice, credential, realmId, key);
    const base = quickBooksApiBaseUrl(credential.baseUrl);
    const company = quickBooksCompany({ apiBaseUrl: base, realmId, accessToken: credential.accessToken, request: deps.request });
    const tax = await companyTax(company, gated.taxApplies);
    companyMode = tax.mode;
    strategy = chooseQuickBooksTaxStrategy({
      taxApplies: gated.taxApplies,
      companyMode,
      defaultTaxCode: tax.defaultCode,
      salesTaxCodes: tax.codes,
      estimateRateBasisPoints: gated.estimateRateBasisPoints,
    });
    const ourNumber = record(tax.preferences?.SalesFormsPrefs).CustomTxnNumbers === true ? deps.docNumber(invoiceId) : null;
    const itemRef =
      (await studioCueInvoiceItemRefs({ tenantId, company, idempotencyKey: key })) ??
      (await deps.fallbackItemRef(base, realmId, credential, key));
    const build = (mode: QuickBooksTaxMode, chosen: QuickBooksTaxStrategy) =>
      quickBooksGatedPayload({ lines: plan.lines, strategy: chosen, companyMode: mode, itemRef });
    payload = build(companyMode, strategy);
    let created =
      (await readInvoice(company, text(invoice.get("providerInvoiceId")))) ??
      (ourNumber ? await findByDocNumber(company, ourNumber) : null);
    if (!created) {
      const post = (online: boolean, body: GatedPayload, suffix: string) =>
        company.post(
          "invoice",
          {
            ...(ourNumber ? { DocNumber: ourNumber } : {}),
            CustomerRef: { value: providerCustomerId },
            DueDate: invoice.get("dueDate"),
            PrivateNote: `StudioCue ${invoiceId}`,
            // StudioCue does the emailing; QuickBooks creating the invoice
            // never reaches the couple.
            EmailStatus: "NotSet",
            ...(online ? deps.onlinePaymentFlags : {}),
            Line: body.Line,
            ...(body.TxnTaxDetail ? { TxnTaxDetail: body.TxnTaxDetail } : {}),
          },
          "QUICKBOOKS_CREATE_FAILED",
          requestId(key, suffix),
        );
      // A 400 created nothing, so asking again cannot duplicate. First
      // without the online-payment flags, then — only if tax codes went —
      // without those: the studio's estimate as a line (or no tax), said so
      // on the review.
      const response = await post(true, payload, ":gated")
        .catch((caught: unknown) => {
          if (refusedCreate(caught)) return post(false, payload, ":offline");
          throw caught;
        })
        .catch((caught: unknown) => {
          if (!refusedCreate(caught) || companyMode === "none") throw caught;
          companyMode = "none";
          strategy = chooseQuickBooksTaxStrategy({
            taxApplies: gated.taxApplies,
            companyMode: "none",
            defaultTaxCode: null,
            salesTaxCodes: [],
            estimateRateBasisPoints: gated.estimateRateBasisPoints,
            codesRefused: true,
          });
          payload = build("none", strategy);
          return post(false, payload, ":plain");
        });
      created = record(response.Invoice);
    }
    providerInvoiceId = text(created.Id);
    docNumber = text(created.DocNumber) || null;
    readBack = quickBooksTaxReadBack(created, { expectedSubtotalCents: payload.expectedSubtotalCents });
    if (providerInvoiceId && !hold) {
      // Not held (a retainer the studio lets go automatically): out it goes,
      // exactly as before.
      hostedUrl = await deps.invoiceLink(base, realmId, credential, providerInvoiceId);
      alreadyDelivered = (
        await deps.enqueueInvoiceEmail({
          db,
          tenantId,
          projectId,
          invoiceId,
          invoiceUrl: hostedUrl,
          kind,
          email: await deps.clientEmailFor(db, tenantId, projectId),
        })
      ).alreadyDelivered;
    }
  }
  if (!providerInvoiceId) throw new Error("QUICKBOOKS_INVOICE_ID_MISSING");
  const now = new Date().toISOString();
  // The tax is QuickBooks' figure now, never a "mismatch". Only a different
  // pre-tax subtotal is: QuickBooks billed the packages differently.
  const mismatch = readBack.preTaxMatches
    ? null
    : {
        basis: "pre_tax",
        expectedCents: payload.expectedSubtotalCents,
        providerSubtotalCents: readBack.subtotalCents,
        providerTotalCents: readBack.totalCents,
        differenceCents: readBack.preTaxDifferenceCents,
        providerTaxCents: readBack.taxCents,
        taxMode: companyMode,
        detectedAt: now,
      };
  if (mismatch)
    console.warn(JSON.stringify({ severity: "WARNING", event: "quickbooks.invoice_subtotal_mismatch", tenantId, invoiceId, ...mismatch }));
  const amountCents = readBack.totalCents > 0 ? readBack.totalCents : cents(invoice.get("amountCents"));
  const fields: Record<string, unknown> = {
    providerInvoiceId,
    providerCustomerId,
    providerState: "completed",
    ...(hostedUrl ? { hostedUrl } : {}),
    providerDocNumber: docNumber,
    providerLines: {
      lines: payload.sentLines,
      taxCents: readBack.taxCents,
      taxMode: companyMode,
      taxAuthority: "quickbooks",
      taxStrategy: strategy,
      taxLocation: readBack.taxLocation,
      itemised: plan.itemised,
      expectedTotalCents: amountCents,
      expectedSubtotalCents: payload.expectedSubtotalCents,
      builtAt: now,
    },
    providerTotals: {
      totalCents: readBack.totalCents,
      balanceCents: readBack.balanceCents,
      taxCents: readBack.taxCents,
      subtotalCents: readBack.subtotalCents,
      readAt: now,
    },
    providerAmountMismatch: mismatch,
    // QuickBooks' tax, on StudioCue's own record (the job's Money view).
    taxCents: readBack.taxCents,
    taxAuthority: "quickbooks",
    amountCents,
    // "itemised" here: no untaxed "Final balance" stand-in line (see quickBooksTaxNote).
    sendReview: hold
      ? sendReviewRecord({ reason: hold, strategy, readBack, itemised: !plan.lines.some((line) => line.kind === "amount"), now })
      : null,
    lastSyncedAt: now,
    updatedAt: now,
    updatedBy: "provider-worker",
  };
  const landed = await deps.landProviderInvoice(invoice.ref, fields, {
    balanceCents: readBack.totalCents > 0 ? readBack.balanceCents : amountCents,
    status: hold ? "review_required" : provider.mock || alreadyDelivered ? "sent" : "awaiting_delivery",
  });
  return { invoiceId, providerInvoiceId, hostedUrl, held: hold, ...landed };
}

/** What the studio sees after any action: the review's figures, freshly read. */
function refreshedReview(previous: Row, readBack: TaxReadBack, now: string, note: string | null, itemised: boolean) {
  const strategy = taxStrategyFromRecord(previous.taxStrategy ?? { kind: previous.strategy });
  const reason: HoldReason = previous.reason === "retainer" ? "retainer" : "final_tax";
  const fresh = sendReviewRecord({ reason, strategy, readBack, itemised, now });
  return { ...fresh, heldAt: text(previous.heldAt) || now, note: note ?? fresh.note };
}

/**
 * The studio's choice, carried out (job `release_quickbooks_invoice`).
 *
 * Nothing reaches the couple until here. Re-reads QuickBooks before sending
 * so the couple is billed what the studio confirmed: if QuickBooks now shows
 * a different total (edited there meanwhile), the bill goes back to the
 * studio with the new figure rather than out.
 */
export async function actOnHeldQuickBooksInvoice(job: DocumentSnapshot, deps: HeldInvoiceDeps) {
  const db = getFirestore();
  const invoiceId = text(job.get("invoiceId"));
  const reference = db.doc(`invoiceReferences/${invoiceId}`);
  const invoice = await reference.get();
  if (!invoice.exists) throw new Error("INVOICE_NOT_FOUND");
  if (invoiceClosedToProviderWork(invoice.get("status"))) return deps.skipClosedInvoice(reference, invoice, job);
  const tenantId = text(invoice.get("tenantId"));
  const projectId = text(invoice.get("projectId"));
  const kind = text(invoice.get("kind"));
  const action = text(job.get("action")) as HeldInvoiceAction;
  const review = record(invoice.get("sendReview"));
  const request = record(review.request);
  const ours = text(request.jobId) === job.id;
  const provider = await deps.connection(tenantId);
  const live = !provider.mock;

  // Sent already by this job, and only the email is in doubt (a retry after
  // the record landed): queue it again — enqueueInvoiceEmail never mails twice.
  if (ours && review.state === "sent") {
    if (live && invoice.get("status") === "awaiting_delivery")
      await deps.enqueueInvoiceEmail({
        db,
        tenantId,
        projectId,
        invoiceId,
        invoiceUrl: text(invoice.get("hostedUrl")) || null,
        kind,
        email: await deps.clientEmailFor(db, tenantId, projectId),
      });
    return { invoiceId, action, state: "sent" };
  }
  const expectedState = action === "recalculate" ? "recalculating" : "releasing";
  if (!ours || invoice.get("status") !== "review_required" || review.state !== expectedState)
    return { invoiceId, action, skipped: "not_pending" };

  const providerLines = record(invoice.get("providerLines"));
  const expectedSubtotalCents = cents(providerLines.expectedSubtotalCents ?? review.subtotalCents);
  const now = () => new Date().toISOString();
  let readBack: TaxReadBack;
  let hostedUrl: string | null = null;
  let note: string | null = null;
  let base = "";
  let realmId = "";
  let credential: Credential | null = null;

  if (!live) {
    // Mock: the arithmetic, no QuickBooks.
    const subtotal = cents(review.subtotalCents);
    const tax = action === "send_without_tax" ? 0 : cents(review.taxCents);
    const known = action === "recalculate" ? Boolean(await coupleBillingAddress(db, tenantId, projectId)) : !review.billingAddressMissing;
    readBack = {
      totalCents: subtotal + tax,
      taxCents: tax,
      subtotalCents: subtotal,
      balanceCents: subtotal + tax,
      billingAddressMissing: !known,
      taxLocation: (review.taxLocation as TaxReadBack["taxLocation"]) ?? null,
      preTaxMatches: true,
      preTaxDifferenceCents: 0,
    };
  } else {
    credential = provider.credential;
    realmId = credential?.realmId ?? text(provider.document.get("providerAccountId"));
    if (!credential || !realmId) throw new Error("QUICKBOOKS_REALM_MISSING");
    base = quickBooksApiBaseUrl(credential.baseUrl);
    const company = quickBooksCompany({ apiBaseUrl: base, realmId, accessToken: credential.accessToken, request: deps.request });
    const providerInvoiceId = text(invoice.get("providerInvoiceId"));
    let current = await company
      .get(`invoice/${encodeURIComponent(providerInvoiceId)}`, "QUICKBOOKS_INVOICE_READ_FAILED")
      .then((value) => record(value.Invoice));
    const key = text(job.get("idempotencyKey")) || job.id;
    if (action === "send_without_tax" && quickBooksInvoiceStillTaxed(current)) {
      const body = quickBooksSparseInvoiceUpdate(current, { Line: quickBooksLinesWithoutTax(current.Line) });
      if (!body) throw new Error("QUICKBOOKS_INVOICE_SYNC_MISSING:409:QuickBooks didn't return the invoice's version");
      current = record((await company.post("invoice", body, "QUICKBOOKS_UPDATE_FAILED", requestId(key, ":untax"))).Invoice);
      if (quickBooksInvoiceStillTaxed(current))
        throw new Error("QUICKBOOKS_TAX_NOT_REMOVED:409:QuickBooks still shows sales tax on this invoice");
    }
    if (action === "recalculate") {
      const address = await coupleBillingAddress(db, tenantId, projectId);
      const billAddr = quickBooksBillAddr(address);
      if (billAddr) {
        // The customer's own blanks first (whatever the studio typed there
        // stays), then the invoice's address, so the tax is worked out again.
        await deps.customerId(tenantId, projectId, invoice, credential, realmId, key);
        const body = quickBooksSparseInvoiceUpdate(current, { BillAddr: billAddr, Line: quickBooksLinesAsSent(current.Line) });
        if (!body) throw new Error("QUICKBOOKS_INVOICE_SYNC_MISSING:409:QuickBooks didn't return the invoice's version");
        current = record((await company.post("invoice", body, "QUICKBOOKS_UPDATE_FAILED", requestId(key, ":address"))).Invoice);
      } else {
        note = "There's still no billing address on the couple's record. Add it on their client record, then work the tax out again.";
      }
    }
    readBack = quickBooksTaxReadBack(current, { expectedSubtotalCents });
  }

  const figures = {
    amountCents: readBack.totalCents,
    taxCents: readBack.taxCents,
    "providerLines.taxCents": readBack.taxCents,
    "providerLines.taxLocation": readBack.taxLocation,
    providerTotals: {
      totalCents: readBack.totalCents,
      balanceCents: readBack.balanceCents,
      taxCents: readBack.taxCents,
      subtotalCents: readBack.subtotalCents,
      readAt: now(),
    },
  };

  // Back to the studio: a recalculation always; a send with tax when
  // QuickBooks no longer shows what the studio confirmed.
  const changedUnderneath = action === "send_with_tax" && live && readBack.totalCents !== cents(invoice.get("amountCents"));
  if (action === "recalculate" || changedUnderneath) {
    const at = now();
    await db.runTransaction(async (transaction) => {
      const fresh = await transaction.get(reference);
      if (invoiceClosedToProviderWork(fresh.get("status"))) return;
      transaction.update(reference, {
        ...figures,
        balanceCents: readBack.balanceCents,
        sendReview: {
          ...refreshedReview(
            review,
            readBack,
            at,
            changedUnderneath
              ? `QuickBooks now shows ${(readBack.totalCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} for this invoice — it was changed there. Check it again before you send.`
              : note,
            !(Array.isArray(providerLines.lines) ? providerLines.lines : []).some((line) => record(line).kind === "amount"),
          ),
          lastAction: { action, jobId: job.id, at, outcome: changedUnderneath ? "changed_in_quickbooks" : "recalculated" },
        },
        updatedAt: at,
        updatedBy: "provider-worker",
      });
    });
    return { invoiceId, action, state: "awaiting_studio", totalCents: readBack.totalCents };
  }

  // Sending: the pay link, then the record, then the email.
  if (live && credential) hostedUrl = await deps.invoiceLink(base, realmId, credential, text(invoice.get("providerInvoiceId")));
  const at = now();
  const landed = await db.runTransaction(async (transaction) => {
    const fresh = await transaction.get(reference);
    if (invoiceClosedToProviderWork(fresh.get("status")) || fresh.get("status") !== "review_required") return false;
    transaction.update(reference, {
      ...figures,
      balanceCents: readBack.balanceCents,
      ...(hostedUrl ? { hostedUrl } : {}),
      status: live ? "awaiting_delivery" : "sent",
      sendReview: {
        ...review,
        state: "sent",
        sentWithTax: action === "send_with_tax" && readBack.taxCents > 0,
        sentAt: at,
        sentBy: text(request.by) || null,
        sentTotalCents: readBack.totalCents,
        sentTaxCents: readBack.taxCents,
      },
      updatedAt: at,
      updatedBy: "provider-worker",
    });
    return true;
  });
  if (!landed) return { invoiceId, action, skipped: "closed_meanwhile" };
  if (live) {
    const delivery = await deps.enqueueInvoiceEmail({
      db,
      tenantId,
      projectId,
      invoiceId,
      invoiceUrl: hostedUrl,
      kind,
      email: await deps.clientEmailFor(db, tenantId, projectId),
    });
    if (delivery.alreadyDelivered)
      await reference.update({ status: "sent", updatedAt: now(), updatedBy: "provider-worker" });
  }
  return { invoiceId, action, state: "sent", totalCents: readBack.totalCents, taxCents: readBack.taxCents };
}

/**
 * The job gave up (a refusal, or out of retries): the bill goes back to the
 * studio to choose again, with what went wrong. It was never sent.
 */
export async function recordHeldInvoiceActionFailed(
  db: Firestore,
  job: DocumentSnapshot,
  failure: { code: string; message: string },
) {
  const invoiceId = text(job.get("invoiceId"));
  if (!invoiceId) return;
  const reference = db.doc(`invoiceReferences/${invoiceId}`);
  await db.runTransaction(async (transaction) => {
    const invoice = await transaction.get(reference);
    if (!invoice.exists) return;
    const review = record(invoice.get("sendReview"));
    if (text(record(review.request).jobId) !== job.id) return;
    if (review.state !== "releasing" && review.state !== "recalculating") return;
    const now = new Date().toISOString();
    transaction.update(reference, {
      sendReview: {
        ...review,
        state: "awaiting_studio",
        lastAction: {
          action: text(job.get("action")),
          jobId: job.id,
          at: now,
          outcome: "failed",
          error: { code: failure.code, message: failure.message.slice(0, 300) },
        },
      },
      updatedAt: now,
      updatedBy: "provider-worker",
    });
  });
}
