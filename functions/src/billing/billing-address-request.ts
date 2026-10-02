import { getFirestore, type DocumentSnapshot, type Firestore, type Transaction } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { clientOutreachStop } from "../post-event/client-outreach.js";
import { normaliseBillingSettings, salesTaxApplies } from "./sales-tax-settings.js";
import { QUICKBOOKS_ITEMISED_FLAG } from "../operations/quickbooks-invoice-plan.js";

/**
 * Asking the couple for their billing address, when the studio needs it.
 *
 * QuickBooks works out sales tax from the billing address. Signing asks for
 * it when the studio charges QuickBooks sales tax, but three kinds of
 * booking never reach that step: couples who signed before the studio
 * switched tax on, bookings imported from another system, and contracts
 * signed outside StudioCue. Their final would be held with "Send with tax"
 * blocked (quickbooks-final-tax.ts) and the studio left to chase it.
 *
 * So, eight weeks before the wedding — four before the final is raised
 * (invoice-scheduler.ts) — a job that will be taxed and has no address on
 * any of its client contacts gets a request:
 *
 *   - a quiet job (imported, paused, on hold) is never emailed by this
 *     scheduler; the studio sees it on Today with "Ask them", its choice;
 *   - any other job: the couple is emailed a link to their portal, where
 *     the same address form as at signing saves it to their own contact
 *     (server/billing/billing-address-request.ts), and the studio sees
 *     "Waiting on …" on Today.
 *
 * One request per job: `billingAddressRequests/{tenantId}_{projectId}`.
 * The studio's "Ask them" / "Ask again" (requestBillingAddress on
 * bookingCommand) sends the email itself, whatever the scheduler decided.
 */

export const BILLING_ADDRESS_REQUEST_WINDOW_DAYS = 56;
export const BILLING_ADDRESS_REQUEST_EMAIL = "billing_address_request";

/** Booked and still ahead, as for the final bill. */
const REQUEST_STATES = ["BOOKED", "PLANNING", "READY"];

export type BillingAddressRequestStatus = "requested" | "needs_studio" | "received";

type Row = Record<string, unknown>;
const record = (value: unknown): Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const billingAddressRequestId = (tenantId: string, projectId: string) => `${tenantId}_${projectId}`;

/** An address worth taxing from: a street and a city. */
export function hasBillingAddress(value: unknown): boolean {
  const address = record(value);
  return Boolean(text(address.line1) && text(address.city));
}

/**
 * Pure: whether this job's final will be taxed by QuickBooks and nobody on
 * it has given an address. The studio's switches first — a studio that
 * isn't on itemised QuickBooks invoices, isn't connected, or doesn't charge
 * QuickBooks sales tax has nothing to ask.
 */
export function billingAddressNeeded(input: {
  project: Row;
  billingSettings: unknown;
  tenantId: string;
  quickBooksConnected: boolean;
  itemisedInvoices: boolean;
  contacts: readonly Row[];
}): boolean {
  if (!input.quickBooksConnected || !input.itemisedInvoices) return false;
  if (!salesTaxApplies(normaliseBillingSettings(input.billingSettings, input.tenantId), input.project)) return false;
  return !input.contacts.some((contact) => hasBillingAddress(contact.billingAddress));
}

/**
 * Pure: what the scheduler does with a job that needs an address. Null for
 * a job it should leave alone; "needs_studio" for a quiet job, which the
 * studio may ask by hand; "requested" when the couple is emailed now.
 */
export function scheduledRequestStatus(project: Row, today: string, horizon: string): BillingAddressRequestStatus | null {
  if (!REQUEST_STATES.includes(text(project.state))) return null;
  const eventDate = text(project.eventDate).slice(0, 10);
  if (!eventDate || eventDate < today || eventDate > horizon) return null;
  const stop = clientOutreachStop(project);
  if (stop === "put_away" || stop === "cancelled") return null;
  return stop === null ? "requested" : "needs_studio";
}

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");

/** The couple's portal, opened at the address card. */
export const billingAddressPortalUrl = () => `${appUrl()}/client?billing-address=1`;

/** The email to the couple. `count` keeps each ask (scheduled, then "Ask again") its own job. */
export function billingAddressEmailJob(input: {
  tenantId: string;
  projectId: string;
  count: number;
  now: string;
  /** The scheduler's sends check the job again when they go; the studio's own press doesn't. */
  automated: boolean;
}) {
  const id = `${BILLING_ADDRESS_REQUEST_EMAIL}_${input.tenantId}_${input.projectId}_${input.count}`;
  return {
    id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    type: BILLING_ADDRESS_REQUEST_EMAIL,
    portalUrl: billingAddressPortalUrl(),
    clientOutreachGuard: input.automated,
    status: "queued",
    attempts: 0,
    maxAttempts: 5,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

async function contactsOf(project: Row, get: (path: string) => Promise<DocumentSnapshot>): Promise<Row[]> {
  const tenantId = text(project.tenantId);
  const ids = (Array.isArray(project.clientContactIds) ? project.clientContactIds : [])
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .slice(0, 4);
  const snapshots = await Promise.all(ids.map((id) => get(`contacts/${id}`)));
  return snapshots
    .filter((snapshot) => snapshot.exists && snapshot.get("tenantId") === tenantId && !snapshot.get("archivedAt"))
    .map((snapshot) => snapshot.data() ?? {});
}

async function studioSwitches(tenantId: string, get: (path: string) => Promise<DocumentSnapshot>) {
  const [settings, connection, features] = await Promise.all([
    get(`billingSettings/${tenantId}`),
    get(`integrationConnections/${tenantId}_quickbooks`),
    get(`tenantFeatures/${tenantId}`),
  ]);
  return {
    billingSettings: settings.exists && settings.get("tenantId") === tenantId ? settings.data() : null,
    quickBooksConnected:
      connection.exists &&
      connection.get("tenantId") === tenantId &&
      connection.get("status") === "connected" &&
      !connection.get("archivedAt"),
    itemisedInvoices: features.exists && features.get(QUICKBOOKS_ITEMISED_FLAG) === true,
  };
}

/**
 * The studio's "Ask them" / "Ask again": emails the couple now, in the
 * command's transaction. Its own press, so it goes even for a quiet job —
 * but never for one put away or called off.
 */
export async function requestBillingAddressIn(
  db: Firestore,
  transaction: Transaction,
  context: { tenantId: string; role: string; actorId: string; now: string },
  input: { projectId: string },
) {
  if (!["studio_owner", "studio_admin"].includes(context.role)) throw new Error("BILLING_ADDRESS_REQUEST_PERMISSION_REQUIRED");
  const get = (path: string) => transaction.get(db.doc(path));
  const project = await get(`projects/${input.projectId}`);
  if (!project.exists || project.get("tenantId") !== context.tenantId) throw new Error("PROJECT_NOT_FOUND");
  const job = project.data() ?? {};
  const stop = clientOutreachStop(job);
  if (stop === "put_away") throw new Error("PROJECT_ARCHIVED");
  if (stop === "cancelled") throw new Error("PROJECT_CANCELLED");
  const requestReference = db.doc(`billingAddressRequests/${billingAddressRequestId(context.tenantId, input.projectId)}`);
  const [existing, contacts] = await Promise.all([transaction.get(requestReference), contactsOf({ ...job, tenantId: context.tenantId }, get)]);
  if (!contacts.some((contact) => text(contact.email).includes("@"))) throw new Error("CLIENT_EMAIL_MISSING");
  if (contacts.some((contact) => hasBillingAddress(contact.billingAddress))) {
    if (existing.exists && existing.get("status") !== "received")
      transaction.update(requestReference, { status: "received", receivedAt: context.now, receivedVia: "studio", updatedAt: context.now });
    throw new Error("BILLING_ADDRESS_ON_FILE");
  }
  const count = Number(existing.get("requestCount") ?? 0) + 1;
  const email = billingAddressEmailJob({ tenantId: context.tenantId, projectId: input.projectId, count, now: context.now, automated: false });
  transaction.set(
    requestReference,
    {
      id: requestReference.id,
      tenantId: context.tenantId,
      projectId: input.projectId,
      status: "requested",
      requestCount: count,
      lastRequestedAt: context.now,
      lastRequestedBy: context.actorId,
      lastEmailJobId: email.id,
      firstRequestedAt: existing.get("firstRequestedAt") ?? context.now,
      createdAt: existing.get("createdAt") ?? context.now,
      updatedAt: context.now,
    },
    { merge: true },
  );
  transaction.create(db.doc(`emailJobs/${email.id}`), email);
  return { projectId: input.projectId, requestCount: count, emailJobId: email.id };
}

/** One job, in its own transaction, so a busy scheduler can't double-ask. */
async function scheduleOne(db: Firestore, project: DocumentSnapshot, today: string, horizon: string, now: string) {
  const job = project.data() ?? {};
  const tenantId = text(job.tenantId);
  if (!tenantId) return "skipped";
  const status = scheduledRequestStatus(job, today, horizon);
  return db.runTransaction(async (transaction) => {
    const get = (path: string) => transaction.get(db.doc(path));
    const requestReference = db.doc(`billingAddressRequests/${billingAddressRequestId(tenantId, project.id)}`);
    const existing = await transaction.get(requestReference);
    const contacts = await contactsOf(job, get);
    // Typed in by the studio, or confirmed some other way since: close it.
    if (existing.exists && existing.get("status") !== "received" && contacts.some((contact) => hasBillingAddress(contact.billingAddress))) {
      transaction.update(requestReference, { status: "received", receivedAt: now, receivedVia: "contact_record", updatedAt: now });
      return "resolved";
    }
    if (!status || existing.exists) return "skipped";
    const switches = await studioSwitches(tenantId, get);
    if (!billingAddressNeeded({ project: job, tenantId, contacts, ...switches })) return "skipped";
    // An email to send needs somebody to send it to.
    const emailed = status === "requested" && contacts.some((contact) => text(contact.email).includes("@"));
    const email = emailed ? billingAddressEmailJob({ tenantId, projectId: project.id, count: 1, now, automated: true }) : null;
    transaction.create(requestReference, {
      id: requestReference.id,
      tenantId,
      projectId: project.id,
      status: emailed ? "requested" : "needs_studio",
      reason: emailed ? null : status === "needs_studio" ? "quiet_job" : "no_client_email",
      requestCount: emailed ? 1 : 0,
      firstRequestedAt: emailed ? now : null,
      lastRequestedAt: emailed ? now : null,
      lastRequestedBy: emailed ? "billing-address-scheduler" : null,
      lastEmailJobId: email?.id ?? null,
      createdAt: now,
      updatedAt: now,
    });
    if (email) transaction.create(db.doc(`emailJobs/${email.id}`), email);
    return emailed ? "requested" : "needs_studio";
  });
}

export const billingAddressRequestScheduler = onSchedule(
  { schedule: "every day 07:00", timeZone: "UTC", retryCount: 3 },
  async () => {
    const db = getFirestore();
    const nowDate = new Date();
    const today = nowDate.toISOString().slice(0, 10);
    const horizonDate = new Date(nowDate);
    horizonDate.setUTCDate(horizonDate.getUTCDate() + BILLING_ADDRESS_REQUEST_WINDOW_DAYS);
    const horizon = horizonDate.toISOString().slice(0, 10);
    const now = nowDate.toISOString();
    const tally: Record<string, number> = {};
    let last: DocumentSnapshot | null = null;
    for (;;) {
      let query = db
        .collection("projects")
        .where("eventDate", ">=", today)
        .where("eventDate", "<=", horizon)
        .orderBy("eventDate")
        .limit(300);
      if (last) query = query.startAfter(last);
      const page = await query.get();
      for (const project of page.docs) {
        try {
          const outcome = await scheduleOne(db, project, today, horizon, now);
          tally[outcome] = (tally[outcome] ?? 0) + 1;
        } catch (caught) {
          tally.failed = (tally.failed ?? 0) + 1;
          console.error(
            JSON.stringify({
              severity: "ERROR",
              event: "billing_address_request.failed",
              projectId: project.id,
              reason: caught instanceof Error ? caught.message : String(caught),
            }),
          );
        }
      }
      if (page.size < 300) break;
      last = page.docs[page.docs.length - 1] ?? null;
    }
    console.log(JSON.stringify({ severity: "INFO", event: "billing_address_request.swept", ...tally }));
  },
);
