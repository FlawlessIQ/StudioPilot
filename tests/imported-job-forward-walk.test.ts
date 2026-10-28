import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { raiseFinalInvoice } from "../functions/src/booking/final-invoice.ts";
import { importedAmendmentBase, importedBaseProposalId } from "../functions/src/contracts/imported-amendment-base.ts";

/**
 * An imported job walked forward on production (2026-10-27): a wedding
 * imported 11 days out, and one imported in editing. The import itself was
 * right; what came after was not. Made-up couples throughout.
 */

// ── A tiny in-memory Firestore (as tests/quickbooks-final-tax.test.ts) ──────
type Doc = Record<string, unknown>;
function fakeFirestore(store: Record<string, Doc>) {
  const ref = (path: string) => ({ path, id: path.split("/").pop()! });
  const snap = (path: string) => {
    const data = store[path];
    return {
      id: path.split("/").pop()!,
      exists: Boolean(data),
      ref: ref(path),
      data: () => data,
      get: (field: string) => field.split(".").reduce<unknown>((value, key) => (value as Doc | undefined)?.[key], data),
    };
  };
  type Query = {
    collection: string;
    filters: Array<[string, unknown]>;
    where: (field: string, op: string, value: unknown) => Query;
    limit: () => Query;
  };
  const query = (collection: string, filters: Array<[string, unknown]> = []): Query => ({
    collection,
    filters,
    where: (field, _op, value) => query(collection, [...filters, [field, value]]),
    limit() {
      return this;
    },
  });
  const writes: Array<[string, string, Doc]> = [];
  const db = { doc: ref, collection: (name: string) => query(name) };
  const transaction = {
    get: async (target: { path?: string } | Query) =>
      "collection" in target
        ? {
            docs: Object.keys(store)
              .filter((path) => path.split("/").length === 2 && path.startsWith(`${target.collection}/`))
              .map(snap)
              .filter((document) => target.filters.every(([field, value]) => document.get(field) === value)),
          }
        : snap(String(target.path)),
    create: (target: { path: string }, data: Doc) => writes.push(["create", target.path, data]),
    set: (target: { path: string }, data: Doc) => writes.push(["set", target.path, data]),
    update: (target: { path: string }, data: Doc) => writes.push(["update", target.path, data]),
  };
  return { db, transaction, snap, writes };
}
const writeTo = (writes: Array<[string, string, Doc]>, path: string) => writes.find(([, target]) => target === path)?.[2];

const imported = (extra: Record<string, Doc> = {}) => ({
  "projects/p": {
    tenantId: "t",
    name: "Ivy Northwalk & Sam Reed",
    state: "BOOKED",
    eventDate: "2026-11-07",
    packageSnapshotId: "s",
    importedAt: "2026-10-27T12:00:00.000Z",
  },
  "packageSnapshots/s": { tenantId: "t", packageId: "imported", totalCents: 420000, taxCents: 0, retainerCents: 200000, currency: "USD" },
  ...extra,
});
const raise = (store: Record<string, Doc>) => {
  const fake = fakeFirestore(store);
  return raiseFinalInvoice(fake.db as never, fake.transaction as never, fake.snap("projects/p") as never, {
    billing: { method: "quickbooks" as const, decided: true, canChoose: true, reason: "chosen" as const },
    invoiceId: "final_p",
    actor: "u1",
    now: "2026-10-27T12:00:00.000Z",
    provider: "quickbooks",
    resolveCustomer: true,
  }).then((result) => ({ result, writes: fake.writes }));
};

test("an import with part of its retainer paid and the rest owed bills the balance once", async () => {
  // $1,500 paid before StudioCue, $500 of the retainer still owed on its own bill.
  const { result, writes } = await raise(
    imported({
      "invoiceReferences/paid": { tenantId: "t", projectId: "p", kind: "retainer", status: "paid", amountCents: 150000, balanceCents: 0, provider: null, providerCustomerId: null },
      "invoiceReferences/owed": { tenantId: "t", projectId: "p", kind: "retainer", status: "sent", amountCents: 50000, balanceCents: 50000, provider: null, providerCustomerId: null, importedOwed: true },
    }),
  );
  // $4,200 − $1,500 paid − $500 billed separately. It took off one record
  // and asked for $2,700 — or $4,200 when the one it found was the owed one.
  assert.equal((result as { amountCents: number }).amountCents, 220000);
  const lines = JSON.stringify((writeTo(writes, "invoiceReferences/final_p")!.calculation as Doc).lines);
  assert.match(lines, /Retainer still owed, billed separately/);
});

test("once the owed retainer is paid, both payments come off", async () => {
  const { result } = await raise(
    imported({
      "invoiceReferences/paid": { tenantId: "t", projectId: "p", kind: "retainer", status: "paid", amountCents: 150000, balanceCents: 0 },
      "invoiceReferences/owed": { tenantId: "t", projectId: "p", kind: "retainer", status: "paid", amountCents: 50000, balanceCents: 0, importedOwed: true },
    }),
  );
  assert.deepEqual(result, { raised: true, invoiceId: "final_p", amountCents: 220000, reviewRequired: false });
});

test("an import with nothing paid can still be billed its whole balance", async () => {
  // No payments and no retainer owed: no retainer record. Today offered
  // "Send the final bill" and the bill refused with no_retainer.
  const { result } = await raise(imported({ "packageSnapshots/s": { tenantId: "t", packageId: "imported", totalCents: 420000, taxCents: 0, retainerCents: 0, currency: "USD" } }));
  assert.equal((result as { amountCents: number }).amountCents, 420000);

  // A job booked in StudioCue still needs its retainer first.
  const { result: native } = await raise({
    ...imported({ "packageSnapshots/s": { tenantId: "t", totalCents: 420000, taxCents: 0, retainerCents: 0, currency: "USD" } }),
    "projects/p": { tenantId: "t", name: "Native", state: "BOOKED", eventDate: "2026-11-07", packageSnapshotId: "s" },
  });
  assert.deepEqual(native, { raised: false, reason: "no_retainer" });
});

test("a booking change on an imported job restates what the import recorded", () => {
  // "This job has no accepted proposal to change" on every imported job: the
  // date of a wedding brought over could not be moved.
  const base = importedAmendmentBase({
    projectId: "p",
    project: { tenantId: "t", name: "Ivy Northwalk & Sam Reed", eventType: "Wedding", eventDate: "2026-11-07", venueName: "Harborview Hall" },
    snapshots: [{ id: "s", data: {} }, { id: "s2", data: {} }],
    pricing: { totalCents: 420000, retainerCents: 150000, currency: "USD" },
    packageDetails: [],
    retainers: [{ dueDate: "2026-04-16" }],
    client: { displayName: "Ivy Northwalk", email: "Ivy.Northwalk@example.com" },
  });
  assert.equal(base.id, importedBaseProposalId("p"));
  assert.equal(base.importedBase, true);
  assert.equal(base.packageSnapshotId, "s");
  assert.deepEqual(base.additionalPackageSnapshotIds, ["s2"]);
  assert.deepEqual(base.paymentSchedule, [
    { label: "Retainer", amountCents: 150000, dueDate: "2026-04-16" },
    { label: "Final balance", amountCents: 270000, dueDate: null },
  ]);
  assert.equal((base.eventSnapshot as Doc).eventDate, "2026-11-07");
  assert.equal((base.clientSnapshot as Doc).email, "ivy.northwalk@example.com");
});

test("an imported job's history says the agreement was signed before StudioCue, not sent or verified by a provider", async () => {
  const { projectThread } = await import("../features/journey/thread.ts");
  const entries = projectThread({
    projectId: "p",
    projectName: "Ivy Northwalk & Sam Reed",
    projectCreatedAt: "2026-10-27T12:00:00.000Z",
    clientName: "Ivy Northwalk",
    contracts: [
      { id: "c", status: "completed", completionAuthority: "imported", createdAt: "2026-10-28T00:40:00.000Z", completedAt: "2026-04-15T00:00:00.000Z" },
    ],
  });
  const text = JSON.stringify(entries);
  assert.doesNotMatch(text, /Agreement sent for signature/);
  assert.doesNotMatch(text, /Verified by the signing provider/);
  assert.match(text, /Agreement signed before StudioCue/);
});

test("an import whose day is still ahead leaves the day's preparation open", () => {
  // Imported 11 days out: questionnaire, certificate, crew, run of show and
  // shot list were all "done before StudioCue" — two photographers sold and
  // nobody booked, "2 things before the day".
  const workflow = readFileSync("functions/src/workflow/commands.ts", "utf8");
  assert.match(workflow, /settledBeforeImport = !input\.imported\.eventAhead \|\| \["Booking", "Payments"\]\.includes/);
  assert.match(workflow, /!\(input\.imported\.retainerOwed && checkpoint\.templateKey === "retainer-paid"\)/);
  const imports = readFileSync("functions/src/imports/commands.ts", "utf8");
  assert.match(imports, /eventAhead: input\.booking\.eventDate >= today/);
});

// ── The second pass: what the walk left open ───────────────────────────────

test("the import preview names the couple as the job will be named", () => {
  // "Ivy & Sam Northwalk" for Ivy Northwalk and Sam Reed.
  const preview = readFileSync("components/imports/spreadsheet-booking-import.tsx", "utf8");
  assert.match(preview, /label: `\$\{\("projectName" in record && record\.projectName\) \|\| defaultBookingName\(record\.clients\)\} · \$\{record\.eventDate\}`/);
});

test("an imported job's history starts where it came from, and says when the couple was brought in", async () => {
  const { projectThread } = await import("../features/journey/thread.ts");
  const entries = projectThread({
    projectId: "p",
    projectName: "Ivy Northwalk & Sam Reed",
    projectCreatedAt: "2026-10-27T12:00:00.000Z",
    importedAt: "2026-10-27T12:00:00.000Z",
    broughtLiveAt: "2026-10-28T09:00:00.000Z",
    clientName: "Ivy",
  });
  const titles = entries.map((entry) => entry.title);
  assert.ok(titles.includes("You imported this booking"));
  assert.ok(titles.includes("You brought the client into StudioCue"));
  const native = projectThread({ projectId: "p", projectName: "Native", projectCreatedAt: "2026-10-27T12:00:00.000Z", clientName: "Ivy" });
  assert.ok(!native.some((entry) => entry.id === "imported"));
});

test("a job imported after its day shows what the day overtook as before StudioCue, not missed", async () => {
  const { projectJourney } = await import("../features/journey/steps.ts");
  const input = {
    projectId: "p",
    state: "POST_PRODUCTION",
    eventDate: "2026-10-17",
    today: "2026-10-27",
    lead: null,
    hasConsultation: true,
    proposalStatus: null,
    contractStatus: "completed",
    retainerInvoiceStatus: "paid",
    finalInvoiceStatus: null,
    questionnaireStatus: null,
    questionnaireHasAnswers: false,
    scheduleStatus: null,
    scheduleHasUsableItems: false,
    crewAccepted: 0,
    crewCascadeActive: false,
    coiStatus: null,
    dayBeforeDraftStatus: null,
    hasDelivery: false,
    albumOrReviewDone: false,
  } as Parameters<typeof projectJourney>[0];
  const native = projectJourney(input).steps;
  assert.ok(native.some((step) => step.status === "passed"), "a native job's undone prep is still missed");
  const imported = projectJourney({ ...input, importedOn: "2026-10-27" }).steps;
  assert.equal(imported.filter((step) => step.status === "passed").length, 0);
  assert.ok(imported.some((step) => step.detail === "Before StudioCue"));
  // Imported before the day: what's missed is missed.
  const early = projectJourney({ ...input, importedOn: "2026-10-01" }).steps;
  assert.ok(early.some((step) => step.status === "passed"));
});

test("a due final balance on no bill is counted on Invoices, and the job says it isn't billed", async () => {
  const { unbilledFinalBalances } = await import("../features/billing/invoice-ledger.ts");
  const job = { id: "p", tenantId: "t", state: "BOOKED", eventDate: "2026-11-07", packageSnapshotId: "s", importedAt: "2026-10-27T12:00:00.000Z" };
  const input = {
    projects: [job],
    proposals: [],
    invoices: [{ id: "r", tenantId: "t", projectId: "p", kind: "retainer", status: "paid", amountCents: 150000, balanceCents: 0 }],
    packageSnapshots: [{ id: "s", tenantId: "t", totalCents: 420000, taxCents: 0 }],
    billingSettings: [],
    connections: [],
    today: "2026-10-27",
    projectId: null,
  };
  assert.deepEqual(unbilledFinalBalances(input), { cents: 270000, count: 1 });
  // Quiet, months away, or already on a final bill: not counted.
  assert.equal(unbilledFinalBalances({ ...input, projects: [{ ...job, clientAutomationsPausedAt: "2026-10-27" }] }).count, 0);
  assert.equal(unbilledFinalBalances({ ...input, projects: [{ ...job, eventDate: "2027-06-01" }] }).count, 0);
  assert.equal(
    unbilledFinalBalances({ ...input, invoices: [...input.invoices, { id: "f", tenantId: "t", projectId: "p", kind: "final", status: "sent", amountCents: 270000, balanceCents: 270000 }] }).count,
    0,
  );
  assert.match(readFileSync("features/journey/steps.ts", "utf8"), /finalDue && !input\.finalInvoiceStatus\s*\? "Due now — not billed yet"/);
});

test("the plan says how much crew the package sold, not 'shooting solo'", () => {
  const brief = readFileSync("components/projects/wedding-brief.tsx", "utf8");
  assert.match(brief, /crewRequiredFromCoverage\(coverage, ownerShootsJob\(project\)\)/);
  assert.match(brief, /sold — \$\{toBook\} still to book/);
});

test("messages that fell due while a job was quiet are skipped, not sent all at once; review asks wait", async () => {
  const { dueLifecycleMessages } = await import("../functions/src/communications/lifecycle-core.ts");
  const { dueLifecycleMessages: shown } = await import("../features/messaging/lifecycle.ts");
  const { defaultLifecycleMessagingSettings } = await import("../features/messaging/schema.ts");
  const project = { id: "p", tenantId: "t", state: "BOOKED", eventDate: "2026-11-07" };
  for (const due of [dueLifecycleMessages, shown]) {
    const caughtUp = due({ project, settings: defaultLifecycleMessagingSettings as never, today: "2026-10-28" });
    const brought = due({ project: { ...project, broughtLiveAt: "2026-10-28T09:00:00.000Z" }, settings: defaultLifecycleMessagingSettings as never, today: "2026-10-28" });
    assert.ok(caughtUp.length > brought.length, "a job booked late still catches up");
    assert.ok(brought.every((message) => message.dueOn >= "2026-10-28"));
  }
  const reviews = readFileSync("functions/src/post-event/jobs.ts", "utf8");
  assert.match(reviews, /if \(stop === "automations_paused"\) \{[\s\S]{0,200}scheduledAt: new Date\(Date\.parse\(now\) \+ 86_400_000\)/);
});
