import assert from "node:assert/strict";
import test from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  contactsToDelete,
  manifest,
  sweepProjectRecords,
} from "../functions/src/projects/purge-command.js";

/**
 * The sweep, run against a real Firestore.
 *
 * tests/project-purge.test.ts reads the source and holds the rules. This one
 * actually deletes things, because the failures that matter here are the ones
 * source cannot show: a cursor that loops for ever, a tenant check that does
 * not hold, a collection missed because nothing thought to name it.
 *
 * Runs under the emulator (`npm run test:purge-sweep`) and skips without one,
 * the same way tests/firestore-rules.test.ts does.
 */

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const options = { skip: !emulatorHost };

const OURS = "tenant-ours";
const THEIRS = "tenant-theirs";
const JOB = "project-doomed";
const KEEP = "project-kept";

function connect(name: string) {
  // No credential: with FIRESTORE_EMULATOR_HOST set the Admin SDK talks to the
  // emulator and never authenticates. A fresh projectId per app keeps each
  // test in its own database.
  const app = initializeApp(
    { projectId: `studiohub-purge-${Date.now()}-${name}` },
    name,
  );
  return { app, db: getFirestore(app) };
}

async function seed(db: FirebaseFirestore.Firestore) {
  const write = (path: string, data: Record<string, unknown>) =>
    db.doc(path).set(data);
  await Promise.all([
    write(`projects/${JOB}`, {
      id: JOB,
      tenantId: OURS,
      projectId: JOB,
      name: "Erin and Joe DeMattia",
      clientContactIds: ["contact-erin", "contact-repeat"],
    }),
    write(`projects/${KEEP}`, {
      id: KEEP,
      tenantId: OURS,
      projectId: KEEP,
      name: "Another Wedding",
      clientContactIds: ["contact-repeat"],
    }),
    write("contacts/contact-erin", { tenantId: OURS, displayName: "Erin" }),
    write("contacts/contact-repeat", { tenantId: OURS, displayName: "Repeat" }),
    // The job's own records, across collections that page and that do not.
    ...Array.from({ length: 12 }, (_, index) =>
      write(`messages/message-${index}`, { tenantId: OURS, projectId: JOB }),
    ),
    write("contracts/contract-1", { tenantId: OURS, projectId: JOB }),
    write("invoiceReferences/invoice-1", { tenantId: OURS, projectId: JOB }),
    write("crewAssignments/assignment-1", {
      tenantId: OURS,
      projectId: JOB,
      status: "completed",
    }),
    // Another studio's record that happens to share the id. The sweep matches
    // on projectId alone, so this is the one that would be destroyed by
    // somebody else's confirmation if the tenant check ever came out.
    write("messages/message-theirs", { tenantId: THEIRS, projectId: JOB }),
    // Ours, but a different job.
    write("messages/message-other-job", { tenantId: OURS, projectId: KEEP }),
    // Shared records that carry no projectId and must simply never be seen.
    write("crewProfiles/crew-1", { tenantId: OURS, name: "Albert" }),
    write("packages/package-1", { tenantId: OURS, name: "Gold" }),
    // The idempotency ledger, deliberately carrying the field.
    write("commandExecutions/command-1", { tenantId: OURS, projectId: JOB }),
    write("webhookEvents/hook-1", { tenantId: OURS, projectId: JOB }),
  ]);
}

const count = async (db: FirebaseFirestore.Firestore, collection: string) =>
  (await db.collection(collection).get()).size;

test("the sweep takes this job and leaves everything else", options, async () => {
  const { app, db } = connect(`sweep-${Date.now()}`);
  try {
    await seed(db);

    const before = await manifest(db, OURS, JOB);
    const lines = Object.fromEntries(
      before.map((line) => [line.collection, line.count]),
    );
    assert.equal(lines.messages, 12, "the preview must count only our messages");
    assert.equal(lines.contracts, 1);
    assert.equal(lines.projects, 1, "the job itself is counted, not swept");
    assert.equal(
      lines.commandExecutions,
      undefined,
      "a protected collection must not even be counted",
    );

    const deleted = await sweepProjectRecords(db, OURS, JOB);
    assert.equal(deleted.messages, 12);
    assert.equal(deleted.contracts, 1);
    assert.equal(deleted.crewAssignments, 1);
    assert.equal(deleted.projects, undefined, "the job record is deferred");

    // What is left, and why each one is still there.
    const remaining = await db.collection("messages").get();
    assert.deepEqual(
      remaining.docs.map((item) => item.id).sort(),
      ["message-other-job", "message-theirs"],
      "another tenant's row and another job's row both survive",
    );
    assert.equal(await count(db, "crewProfiles"), 1, "the directory is untouched");
    assert.equal(await count(db, "packages"), 1, "the catalogue is untouched");
    assert.equal(await count(db, "commandExecutions"), 1, "idempotency survives");
    assert.equal(await count(db, "webhookEvents"), 1, "webhook dedupe survives");
    assert.equal(await count(db, "projects"), 2, "the job is deleted by name, last");

    // A second sweep must be a no-op rather than an error: a purge that failed
    // half way is finished by running it again.
    assert.deepEqual(await sweepProjectRecords(db, OURS, JOB), {});
  } finally {
    await deleteApp(app);
  }
});

test("the couple go only when this was their last job", options, async () => {
  const { app, db } = connect(`contacts-${Date.now()}`);
  try {
    await seed(db);
    const contacts = await contactsToDelete(db, OURS, JOB, [
      "contact-erin",
      "contact-repeat",
    ]);
    assert.deepEqual(
      contacts.deleting.map((contact) => contact.id),
      ["contact-erin"],
      "a client with no other job leaves with it",
    );
    assert.deepEqual(
      contacts.keeping.map((contact) => contact.id),
      ["contact-repeat"],
      "a client who books twice must survive the first job being purged",
    );
  } finally {
    await deleteApp(app);
  }
});

/** Paging: more rows than one page, deleted while the cursor walks them. */
test("a job larger than one page is fully swept", options, async () => {
  const { app, db } = connect(`paging-${Date.now()}`);
  try {
    const total = 750;
    for (let start = 0; start < total; start += 250) {
      const batch = db.batch();
      for (let index = start; index < Math.min(start + 250, total); index += 1)
        batch.set(db.doc(`auditEvents/event-${String(index).padStart(4, "0")}`), {
          tenantId: OURS,
          projectId: JOB,
        });
      await batch.commit();
    }
    const deleted = await sweepProjectRecords(db, OURS, JOB);
    assert.equal(deleted.auditEvents, total);
    assert.equal(await count(db, "auditEvents"), 0);
  } finally {
    await deleteApp(app);
  }
});
