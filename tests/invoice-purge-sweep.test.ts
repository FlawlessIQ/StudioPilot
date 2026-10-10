import assert from "node:assert/strict";
import test from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { deleteInvoiceRecords, sweepInvoiceRecords } from "../functions/src/billing/invoice-purge.js";

/**
 * Deleting invoice records, against a real Firestore (own invoicing, Phase 5).
 * tests/invoice-purge.test.ts holds the rules; this one actually deletes,
 * because the failures that matter — a tenant check that doesn't hold, a
 * record missed, a second run that does something — only show here.
 *
 * Runs under the emulator (`npm run test:invoice-purge`) and skips without one.
 */

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const options = { skip: !emulatorHost };

const OURS = "tenant-ours";
const THEIRS = "tenant-theirs";
const JOB = "job-1";
const DEPOSIT = "invoice_deposit";
const FINAL = "invoice_final";

function connect(name: string) {
  const app = initializeApp({ projectId: `studiohub-invoice-purge-${Date.now()}-${name}` }, name);
  return { app, db: getFirestore(app) };
}

async function seed(db: FirebaseFirestore.Firestore) {
  const write = (path: string, data: Record<string, unknown>) => db.doc(path).set(data);
  await Promise.all([
    write(`projects/${JOB}`, { id: JOB, tenantId: OURS, projectId: JOB, name: "Priya & Jordan", eventKind: "wedding" }),
    write(`invoiceReferences/${DEPOSIT}`, { tenantId: OURS, projectId: JOB, kind: "retainer", billedBy: "studio", provider: null, number: "INV-0001", status: "paid", amountCents: 191000, balanceCents: 0 }),
    write(`invoiceReferences/${FINAL}`, { tenantId: OURS, projectId: JOB, kind: "final", billedBy: "studio", provider: null, number: "INV-0002", status: "paid", amountCents: 582988, balanceCents: 0 }),
    // Everything that names the deposit…
    write(`documents/studio_invoice_${DEPOSIT}`, { tenantId: OURS, projectId: JOB, invoiceId: DEPOSIT }),
    write(`pdfJobs/invoice_${DEPOSIT}_r1`, { tenantId: OURS, projectId: JOB, invoiceId: DEPOSIT, status: "succeeded" }),
    write(`emailJobs/studio_invoice_${DEPOSIT}_x`, { tenantId: OURS, projectId: JOB, invoiceId: DEPOSIT, status: "succeeded" }),
    write(`aiActions/ai_payment_reminder_${DEPOSIT}_1`, { tenantId: OURS, projectId: JOB, status: "approved" }),
    write(`auditEvents/a1`, { tenantId: OURS, entityId: DEPOSIT, action: "retainer.payment_attested", before: { status: "sent", balanceCents: 191000 }, after: { status: "paid", amountCents: 191000, method: "Zelle", reference: "Z-1" } }),
    // …and another studio's record that happens to share its id: never ours to delete.
    write(`documents/theirs`, { tenantId: THEIRS, projectId: "other", invoiceId: DEPOSIT }),
    write(`auditEvents/theirs`, { tenantId: THEIRS, entityId: DEPOSIT, before: { amountCents: 1 } }),
    // Never swept.
    write(`commandExecutions/${OURS}_k`, { tenantId: OURS, invoiceId: DEPOSIT }),
  ]);
}

const context = (key: string) => ({
  tenantId: OURS,
  membership: { role: "studio_owner" },
  actorId: "owner",
  timestamp: "2026-10-10T12:00:00.000Z",
  idempotencyKey: key,
  ipAddress: null,
  userAgent: null,
});

test("a paid deposit can't go while the final it's netted against is still to come", options, async () => {
  const { app, db } = connect("refuse");
  try {
    await seed(db);
    await db.doc(`invoiceReferences/${FINAL}`).update({ status: "sent", balanceCents: 582988 });
    await assert.rejects(
      deleteInvoiceRecords(db, context("refuse-1"), { projectId: JOB, invoiceId: DEPOSIT, confirmation: null }, { storage: false }),
      /INVOICE_STILL_NEEDED/,
    );
    assert.ok((await db.doc(`invoiceReferences/${DEPOSIT}`).get()).exists, "nothing deleted");
    assert.equal((await db.doc(`projects/${JOB}`).get()).get("billing"), undefined, "no note written");
  } finally {
    await deleteApp(app);
  }
});

test("the whole job: settled notes first, everything that names each bill, the bills last, theirs untouched", options, async () => {
  const { app, db } = connect("job");
  try {
    await seed(db);
    await assert.rejects(
      deleteInvoiceRecords(db, context("job-0"), { projectId: JOB, invoiceId: null, confirmation: "Someone else" }, { storage: false }),
      /INVOICE_DELETE_CONFIRMATION_MISMATCH/,
    );
    const result = await deleteInvoiceRecords(db, context("job-1"), { projectId: JOB, invoiceId: null, confirmation: "priya &  jordan" }, { storage: false });
    assert.deepEqual([...result.deleted].sort(), [DEPOSIT, FINAL]);
    assert.deepEqual([...result.settled].sort(), ["final", "retainer"]);

    const project = (await db.doc(`projects/${JOB}`).get()).data()!;
    assert.equal(project.billing.recordsDeletedAt, "2026-10-10T12:00:00.000Z");
    assert.deepEqual(Object.keys(project.billing.settled).sort(), ["final", "retainer"]);
    assert.doesNotMatch(JSON.stringify(project.billing), /Cents|amount/i, "the note carries no money");

    for (const path of [
      `invoiceReferences/${DEPOSIT}`,
      `invoiceReferences/${FINAL}`,
      `documents/studio_invoice_${DEPOSIT}`,
      `pdfJobs/invoice_${DEPOSIT}_r1`,
      `emailJobs/studio_invoice_${DEPOSIT}_x`,
      `aiActions/ai_payment_reminder_${DEPOSIT}_1`,
    ])
      assert.equal((await db.doc(path).get()).exists, false, path);
    // Another studio's records, and idempotency rows, stay exactly as they were.
    assert.ok((await db.doc("documents/theirs").get()).exists);
    assert.deepEqual((await db.doc("auditEvents/theirs").get()).get("before"), { amountCents: 1 });
    assert.ok((await db.doc(`commandExecutions/${OURS}_k`).get()).exists);
    // Our audit stays, without the money; one tombstone per bill, without amounts.
    const audit = (await db.doc("auditEvents/a1").get()).data()!;
    assert.deepEqual(audit.before, { status: "sent" });
    assert.deepEqual(audit.after, { status: "paid" });
    const tombstones = await db.collection("auditEvents").where("action", "==", "invoice.deleted").get();
    assert.equal(tombstones.size, 2);
    for (const tombstone of tombstones.docs) assert.doesNotMatch(JSON.stringify(tombstone.data()), /Cents/);

    // A second run finds nothing and deletes nothing.
    assert.deepEqual(await sweepInvoiceRecords(db, { tenantId: OURS, projectId: JOB, invoiceId: DEPOSIT, actorId: "owner", now: "x", storage: false }), {
      deleted: 0,
      scrubbed: 0,
      files: 0,
    });
  } finally {
    await deleteApp(app);
  }
});

test("deleting an unpaid bill loses nothing: the job can be billed again", options, async () => {
  const { app, db } = connect("unpaid");
  try {
    await seed(db);
    await db.doc(`invoiceReferences/${FINAL}`).update({ status: "draft", balanceCents: 582988 });
    await deleteInvoiceRecords(db, context("unpaid-1"), { projectId: JOB, invoiceId: FINAL, confirmation: null }, { storage: false });
    assert.equal((await db.doc(`invoiceReferences/${FINAL}`).get()).exists, false);
    const billing = (await db.doc(`projects/${JOB}`).get()).get("billing") ?? {};
    assert.equal(billing.recordsDeletedAt, undefined, "no 'records deleted' mark for an unpaid bill");
    assert.equal(billing.settled, undefined, "and no settled note");
    assert.ok((await db.doc(`invoiceReferences/${DEPOSIT}`).get()).exists, "the deposit stays");
  } finally {
    await deleteApp(app);
  }
});
