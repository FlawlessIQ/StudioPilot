import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { balanceCollectedOnTheDay, morningBalance } from "@/features/billing/balance-on-the-day";
import { tradeProfile } from "@/features/trades/trades";
import {
  afterDayReviewAsks,
  afterDayReviewPlan,
  studioReviewDestination,
} from "../functions/src/post-event/after-day-reviews.ts";
import { reviewAskWrites } from "../functions/src/post-event/release.ts";
import {
  FINAL_BILL_WINDOW_DAYS,
  balanceCollectedOnTheDay as serverBalanceOnTheDay,
  finalBillRaiseDaysBefore,
  mayRaiseFinalBill,
} from "../functions/src/operations/invoice-scheduler.ts";

/**
 * Simpler vendor journeys, Phases 4 and 5: the balance the vendor way, and
 * review asks after the day.
 *
 * - A makeup artist or hair stylist is paid on the morning. No final invoice
 *   goes out weeks ahead; the client's Payments screen says what is due on
 *   the morning; the studio records it in one tap. A saved autopay card is
 *   the one exception: billed the day before, charged on the morning.
 * - A DJ's final bill goes out by itself, due two weeks before the night.
 * - A trade that delivers nothing gets the same two review asks a delivery
 *   schedules, from the move to EVENT_COMPLETE.
 * - A photographer's journey does not change at all.
 */

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

type Data = Record<string, unknown>;

/** Just enough Firestore for the review-ask transaction: docs, two-field queries, create. */
function fakeDb(seed: Record<string, Data>) {
  const store = new Map<string, Data>(Object.entries(seed).map(([path, data]) => [path, structuredClone(data)]));
  let reads = 0;
  const doc = (path: string) => ({ path, id: path.split("/").pop()! });
  const snapshot = (path: string) => {
    const data = store.get(path);
    return {
      id: path.split("/").pop()!,
      ref: doc(path),
      exists: data !== undefined,
      data: () => (data ? structuredClone(data) : undefined),
      get: (field: string) => (data ? data[field] : undefined),
    };
  };
  function query(collection: string, filters: Array<[string, unknown]> = []) {
    return {
      kind: "query" as const,
      collection,
      filters,
      where: (field: string, _op: string, value: unknown) => query(collection, [...filters, [field, value]]),
      limit: () => query(collection, filters),
    };
  }
  const transaction = {
    get: async (target: { path?: string; kind?: string; collection?: string; filters?: Array<[string, unknown]> }) => {
      reads += 1;
      if (target.kind === "query") {
        const docs = [...store.keys()]
          .filter((path) => path.startsWith(`${target.collection}/`))
          .map(snapshot)
          .filter((snap) => target.filters!.every(([field, value]) => snap.get(field) === value));
        return { docs, empty: docs.length === 0 };
      }
      return snapshot(target.path!);
    },
    create: (ref: { path: string }, data: Data) => {
      if (store.has(ref.path)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
      store.set(ref.path, structuredClone(data));
    },
  };
  return {
    db: { doc, collection: (name: string) => query(name) } as unknown as Firestore,
    transaction: transaction as unknown as Transaction,
    store,
    snapshot: (path: string) => snapshot(path) as unknown as DocumentSnapshot,
    reads: () => reads,
  };
}

const NOW = "2026-10-11T23:30:00.000Z";
const GOOGLE = "https://g.page/r/maya-beauty/review";
const studio = (trade: string, reviewLinks: Data = { google: GOOGLE }) => ({ tenantId: "t1", trade, reviewLinks });
const wedding = (project: Data = {}) => ({ tenantId: "t1", eventKind: "wedding", state: "READY", eventDate: "2026-10-11", ...project });

// ── Phase 5: review asks after the day ────────────────────────────────────

test("a trade that delivers nothing is asked for its review after the day", () => {
  for (const trade of ["dj", "makeup", "hair"]) {
    assert.deepEqual(afterDayReviewPlan(wedding(), studio(trade)), {
      schedule: true,
      destinationUrl: GOOGLE,
      destinationLabel: "google",
    }, trade);
  }
});

test("a photographer's asks still wait for the gallery", () => {
  assert.deepEqual(afterDayReviewPlan(wedding(), studio("photographer")), { schedule: false, reason: "delivers" });
  // A studio with no trade on file is a photographer.
  assert.deepEqual(afterDayReviewPlan(wedding(), { reviewLinks: { google: GOOGLE } }), { schedule: false, reason: "delivers" });
});

test("the delivery's guards hold after the day too", () => {
  const plan = (project: Data, tenant = studio("dj")) => afterDayReviewPlan(wedding(project), tenant);
  // A quiet imported booking (ADR 0005), and every other outreach stop.
  assert.deepEqual(plan({ clientAutomationsPausedAt: "2026-09-17T14:00:00.000Z" }), { schedule: false, reason: "outreach_stopped" });
  assert.deepEqual(plan({ archivedAt: "2026-10-01" }), { schedule: false, reason: "outreach_stopped" });
  assert.deepEqual(plan({ state: "CANCELLED" }), { schedule: false, reason: "outreach_stopped" });
  // "Don't ask this couple."
  assert.deepEqual(plan({ reviewRequestsSkippedAt: "2026-10-01T00:00:00.000Z" }), { schedule: false, reason: "skipped" });
  // No saved link, or one that isn't a web address.
  assert.deepEqual(plan({}, studio("dj", {})), { schedule: false, reason: "no_review_link" });
  assert.deepEqual(plan({}, studio("dj", { google: "not a link", custom: "http://plain.example" })), {
    schedule: false,
    reason: "no_review_link",
  });
});

test("the studio's review link is the one set in Settings, else the first saved in the delivery form's order", () => {
  assert.deepEqual(studioReviewDestination({ reviewLinks: { google: null, theKnot: "https://theknot.com/r/1", custom: "https://x.example" } }), {
    url: "https://x.example",
    label: "custom",
  });
  assert.deepEqual(studioReviewDestination({ reviewLinks: { google: null, theKnot: "https://theknot.com/r/1" } }), {
    url: "https://theknot.com/r/1",
    label: "the_knot",
  });
  assert.equal(studioReviewDestination({}), null);
});

test("reaching EVENT_COMPLETE schedules the two asks a delivery would, once", async () => {
  const fake = fakeDb({ "projects/p1": wedding(), "tenants/t1": studio("dj") });
  const run = () =>
    afterDayReviewAsks(fake.db, fake.transaction, {
      project: fake.snapshot("projects/p1"),
      tenant: fake.snapshot("tenants/t1"),
      actorId: "owner",
      now: NOW,
    });
  const first = await run();
  assert.equal(first.scheduled, 2);
  assert.deepEqual(first.projectFields, { reviewRequestsScheduledAt: NOW });
  for (const write of first.writes) write();
  const portal = fake.store.get("reviewRequests/review_p1_1")!;
  const email = fake.store.get("reviewRequests/review_p1_2")!;
  // Both by email: after a DJ's night there is no gallery to come back to.
  assert.equal(portal.channel, "email");
  assert.equal(email.channel, "email");
  // Three days after the night, and ten.
  assert.equal(portal.scheduledAt, "2026-10-14T23:30:00.000Z");
  assert.equal(email.scheduledAt, "2026-10-21T23:30:00.000Z");
  for (const ask of [portal, email]) {
    assert.equal(ask.status, "scheduled");
    assert.equal(ask.tenantId, "t1");
    assert.equal(ask.projectId, "p1");
    assert.equal(ask.destinationUrl, GOOGLE);
    assert.equal(ask.destinationLabel, "google");
    assert.equal(ask.deliveryRecordId, null);
    // What lets the scheduler move the job from the day to the review.
    assert.equal(ask.askedAfter, "event_day");
  }
  // Keyed by the project: a second move to the day schedules nothing.
  const second = await run();
  assert.equal(second.scheduled, 0);
  assert.deepEqual(second.projectFields, {});
  assert.equal(second.writes.length, 0);
});

test("with no review link the job records it finished without asks, as a delivery does", async () => {
  const fake = fakeDb({ "projects/p1": wedding(), "tenants/t1": studio("makeup", {}) });
  const result = await afterDayReviewAsks(fake.db, fake.transaction, {
    project: fake.snapshot("projects/p1"),
    tenant: fake.snapshot("tenants/t1"),
    actorId: "owner",
    now: NOW,
  });
  assert.equal(result.scheduled, 0);
  assert.deepEqual(result.projectFields, {
    reviewRequestsSkippedAt: NOW,
    reviewRequestsSkippedBy: "owner",
    reviewRequestsSkippedReason: "no_review_link",
  });
  assert.match(read("functions/src/post-event/release.ts"), /reviewRequestsSkippedReason: "no_review_link"/);
});

test("a photographer's move to the day reads nothing and writes nothing", async () => {
  const fake = fakeDb({ "projects/p1": wedding(), "tenants/t1": studio("photographer") });
  const before = fake.reads();
  const result = await afterDayReviewAsks(fake.db, fake.transaction, {
    project: fake.snapshot("projects/p1"),
    tenant: fake.snapshot("tenants/t1"),
    actorId: "owner",
    now: NOW,
  });
  assert.equal(fake.reads(), before);
  assert.deepEqual(result, { plan: { schedule: false, reason: "delivers" }, scheduled: 0, projectFields: {}, writes: [] });
});

test("a delivery's asks are the records they always were", async () => {
  const fake = fakeDb({});
  const asks = await reviewAskWrites(fake.db, fake.transaction, {
    tenantId: "t1",
    projectId: "p1",
    actorId: "owner",
    now: NOW,
    deliveryRecordId: "delivery_1",
    destinationUrl: GOOGLE,
    destinationLabel: "google",
    skipReviews: false,
  });
  for (const write of asks.writes) write();
  assert.deepEqual(Object.keys(fake.store.get("reviewRequests/review_p1_1")!), [
    "id", "tenantId", "projectId", "deliveryRecordId", "channel", "destinationLabel", "destinationUrl", "status",
    "sequence", "scheduledAt", "sentAt", "deliveredAt", "openedAt", "clickedAt", "confirmedAt", "confirmedBy",
    "messageId", "createdAt", "updatedAt", "createdBy", "updatedBy", "archivedAt",
  ]);
  assert.equal(fake.store.get("reviewRequests/review_p1_1")!.deliveryRecordId, "delivery_1");
  // The release still hands the helper its delivery and its review link.
  const release = read("functions/src/post-event/release.ts");
  assert.match(release, /deliveryRecordId: input\.deliveryRecordId,\n\s+destinationUrl: input\.followUps\.reviewDestinationUrl,/);
  assert.match(release, /resume\(reviewDocs, \[3, 10\], !input\.skipReviews\);/);
});

test("the move to EVENT_COMPLETE is where the asks are scheduled, reads before writes", () => {
  const crm = read("functions/src/crm/commands.ts");
  const branch = crm.slice(crm.indexOf('if (command.type === "transitionProject")'), crm.indexOf('if (command.type === "uncancelProject")'));
  const call = branch.indexOf("await afterDayReviewAsks(db, transaction, {");
  const update = branch.indexOf("transaction.update(projectReference, {");
  assert.ok(call > 0 && call < update, "the asks' reads come before the job's update");
  assert.match(branch, /command\.input\.targetState === "EVENT_COMPLETE"\s*\?\s*await afterDayReviewAsks/);
  assert.match(branch, /\.\.\.\(afterDayReviews\?\.projectFields \?\? \{\}\),/);
  assert.match(branch, /for \(const write of afterDayReviews\?\.writes \?\? \[\]\) write\(\);/);
});

test("the first ask moves a vendor's job from the day to the review, and only theirs", () => {
  const jobs = read("functions/src/post-event/jobs.ts");
  // A photographer's, from DELIVERED, unchanged.
  assert.match(jobs, /project\.get\("state"\) === "DELIVERED"\) \{\s*transaction\.update\(projectReference, \{\s*state: "REVIEW_REQUESTED",/);
  assert.match(
    jobs,
    /project\.get\("state"\) === "EVENT_COMPLETE" &&\s*current\.get\("askedAfter"\) === "event_day"\s*\) \{[\s\S]{0,400}state: "REVIEW_REQUESTED",/,
  );
  // And it is still the outreach-stopped, hourly scheduler that sends them.
  assert.match(jobs, /clientOutreachStop\(project\.data\(\)\)/);
});

// ── Phase 4: the balance ──────────────────────────────────────────────────

test("makeup and hair collect the balance on the day; nobody else does", () => {
  for (const [trade, onTheDay] of [["makeup", true], ["hair", true], ["dj", false], ["photographer", false]] as const) {
    assert.equal(balanceCollectedOnTheDay(wedding(), trade), onTheDay, trade);
    assert.equal(serverBalanceOnTheDay(wedding(), trade), onTheDay, `${trade} (functions)`);
  }
  // Only a job booked with a deposit has a balance left for the day.
  assert.equal(balanceCollectedOnTheDay(wedding({ paymentShape: "paid_in_full" }), "makeup"), false);
});

test("a photographer's final bill is raised exactly when it always was", () => {
  const today = "2026-09-30";
  const horizon = "2026-10-28";
  assert.equal(finalBillRaiseDaysBefore("photographer"), 28);
  for (const trade of [undefined, "photographer"]) {
    assert.equal(mayRaiseFinalBill(wedding({ eventDate: "2026-10-28" }), today, horizon, { trade }), true);
    assert.equal(mayRaiseFinalBill(wedding({ eventDate: "2026-10-01" }), today, horizon, { trade }), true);
    assert.equal(mayRaiseFinalBill(wedding({ eventDate: "2026-10-29" }), today, horizon, { trade }), false);
  }
  assert.equal(mayRaiseFinalBill(wedding({ eventDate: "2026-10-28" }), today, horizon), true, "no trade passed");
});

test("a DJ's final bill goes out by itself, two weeks before it falls due", () => {
  const today = "2026-09-30";
  const horizon = "2026-10-28";
  assert.equal(tradeProfile("dj").balanceDueDaysBefore, 14);
  assert.equal(finalBillRaiseDaysBefore("dj"), 28);
  assert.equal(mayRaiseFinalBill(wedding({ eventDate: "2026-10-28" }), today, horizon, { trade: "dj" }), true);
  assert.equal(mayRaiseFinalBill(wedding({ eventDate: "2026-10-29" }), today, horizon, { trade: "dj" }), false);
  // Its due date is the trade's (final-invoice.ts), not a fixed fortnight.
  assert.match(
    read("functions/src/booking/final-invoice.ts"),
    /due\.setUTCDate\(due\.getUTCDate\(\) - tradeProfile\(tenant\.get\("trade"\)\)\.balanceDueDaysBefore\)/,
  );
});

test("the daily run reads the widest trade's window and holds each job to its own", () => {
  const scheduler = read("functions/src/operations/invoice-scheduler.ts");
  const literal = Number(/target\.setUTCDate\(target\.getUTCDate\(\) \+ (\d+)\)/.exec(scheduler)?.[1]);
  assert.equal(literal, FINAL_BILL_WINDOW_DAYS);
  assert.match(scheduler, /mayRaiseFinalBill\(project\.data\(\), date\(today\), date\(target\), \{ trade, autopayCard \}\)/);
});

test("makeup and hair are never sent a final bill weeks ahead", () => {
  const today = "2026-09-30";
  const horizon = "2026-10-28";
  for (const trade of ["makeup", "hair"]) {
    for (const eventDate of ["2026-10-28", "2026-10-14", "2026-10-02", "2026-10-01", "2026-09-30"])
      assert.equal(mayRaiseFinalBill(wedding({ eventDate }), today, horizon, { trade }), false, `${trade} ${eventDate}`);
  }
});

test("a saved autopay card is billed the day before and charged on the morning", () => {
  const today = "2026-09-30";
  const horizon = "2026-10-28";
  const card = { trade: "makeup", autopayCard: true };
  assert.equal(mayRaiseFinalBill(wedding({ eventDate: "2026-10-01" }), today, horizon, card), true, "the day before");
  assert.equal(mayRaiseFinalBill(wedding({ eventDate: "2026-09-30" }), today, horizon, card), true, "the morning itself");
  assert.equal(mayRaiseFinalBill(wedding({ eventDate: "2026-10-02" }), today, horizon, card), false, "not two days ahead");
  // A quiet imported booking is never billed, card or not.
  assert.equal(
    mayRaiseFinalBill(wedding({ eventDate: "2026-10-01", clientAutomationsPausedAt: "2026-09-17" }), today, horizon, card),
    false,
  );
  // The run looks for the card only for a morning balance, at a studio with autopay on.
  const scheduler = read("functions/src/operations/invoice-scheduler.ts");
  assert.match(scheduler, /balanceCollectedOnTheDay\(project\.data\(\), trade\) &&/);
  assert.match(scheduler, /\.enabled === true &&/);
  assert.match(scheduler, /\.where\("status", "==", "active"\)/);
  // Autopay charges a final from its due date, which for makeup is the morning.
  assert.equal(tradeProfile("makeup").balanceDueDaysBefore, 0);
});

const accepted = {
  status: "accepted",
  version: 2,
  pricingSnapshot: { totalCents: 100_000, currency: "USD" },
  paymentSchedule: [
    { label: "Retainer", amountCents: 30_000, dueDate: "2026-06-01" },
    { label: "Final balance", amountCents: 70_000, dueDate: "2026-10-11" },
  ],
};
const paidRetainer = { kind: "retainer", status: "paid", amountCents: 30_000, balanceCents: 0 };

test("the client sees the balance due on the morning, not an invoice to chase", () => {
  const view = (project: Data, overrides: { trade?: string; invoices?: Data[]; today?: string } = {}) =>
    morningBalance({
      project: wedding(project),
      trade: overrides.trade ?? "makeup",
      proposals: [accepted],
      invoices: overrides.invoices ?? [paidRetainer],
      today: overrides.today ?? "2026-10-01",
    });
  assert.deepEqual(view({}), { amountCents: 70_000, currency: "USD", eventDate: "2026-10-11", today: false, past: false });
  assert.equal(view({}, { today: "2026-10-11" })?.today, true);
  assert.equal(view({}, { today: "2026-10-12" })?.past, true);
  assert.equal(view({}, { trade: "hair" })?.amountCents, 70_000);
  // A bill already out — sent by hand, or raised for autopay — is shown as the invoice it is.
  assert.equal(view({}, { invoices: [paidRetainer, { kind: "final", status: "sent", amountCents: 70_000, balanceCents: 70_000 }] }), null);
  assert.equal(view({}, { invoices: [paidRetainer, { kind: "final", status: "paid", amountCents: 70_000, balanceCents: 0 }] }), null);
  // A voided final doesn't count as one.
  assert.equal(view({}, { invoices: [paidRetainer, { kind: "final", status: "voided" }] })?.amountCents, 70_000);
  // Nobody else pays this way.
  assert.equal(view({}, { trade: "dj" }), null);
  assert.equal(view({}, { trade: "photographer" }), null);
  assert.equal(view({ paymentShape: "paid_in_full" }), null);
  // Nothing agreed, nothing owed.
  assert.equal(
    morningBalance({ project: wedding(), trade: "makeup", proposals: [], invoices: [], today: "2026-10-01" }),
    null,
  );
});

test("without a schedule line, the balance is the total less the retainer paid", () => {
  const result = morningBalance({
    project: wedding(),
    trade: "makeup",
    proposals: [{ ...accepted, paymentSchedule: undefined }],
    invoices: [{ kind: "retainer", status: "partially_paid", amountCents: 30_000, balanceCents: 10_000 }],
    today: "2026-10-01",
  });
  assert.equal(result?.amountCents, 80_000);
});

test("the Payments screen says it plainly", () => {
  const payments = read("components/client/kit/client-payments.tsx");
  assert.match(payments, /morningBalance\(\{/);
  assert.match(payments, /The balance of \$\{morningAmount\}/);
  assert.match(payments, /is due on the morning\./);
  // Still the shared pay decision for an invoice that does stand.
  assert.match(payments, /invoicePayRoute\(/);
});

test("collecting it on the day is one tap for the studio", () => {
  const record = read("components/booking/record-final-payment.tsx");
  assert.match(record, /onTheDay\?: boolean;/);
  assert.match(record, /void record\(\{ paidAt: todayLocalIso\(\), method: option\.method, reference: null \}\)/);
  for (const method of ["Card", "Cash", "Venmo or Zelle", "Check"]) assert.match(record, new RegExp(`method: "${method}"`));
  // No amount from the browser: the server reads the agreed balance.
  assert.doesNotMatch(record, /amountCents/);
});
