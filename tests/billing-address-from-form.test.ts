import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { addressFromAnswer } from "@/features/contacts/billing-address-signing";
import { recommendedQuestionnaires } from "@/features/questionnaires/recommended-templates";
import {
  addressFromAnswer as functionsAddressFromAnswer,
  billingAddressFromForm,
  isBillingAddressQuestion,
  saveFormBillingAddress,
} from "../functions/src/contacts/address-from-form";

/**
 * GR, 2026-10-06: "billing address isn't populating with the info from event
 * form." Tiffany O'Donnell's form (submitted that morning) asked for prep,
 * ceremony and reception places and nothing else; there was no address of
 * hers to take.
 */

const ANSWERS = [
  "140 Briarwood Rd\nFlorham Park, NJ 07932",
  "140 Briarwood Rd, Florham Park NJ 07932-2561",
  "12 Elm St\nApt 4\nNew York, NY 10001",
  "12 Elm St, New York, NY 10001, USA",
  "9 Oak St, Madison, New Jersey 07940",
  { line1: "1 Main St", city: "Morristown", region: "New Jersey", postalCode: "07960" },
  { formatted: "1 Main St, Morristown, NJ 07960" },
  "TBD",
  "Florham Park",
  "",
  null,
];

test("the functions copy of the address reader agrees with the app's", () => {
  for (const answer of ANSWERS) {
    assert.deepEqual(functionsAddressFromAnswer(answer), addressFromAnswer(answer), JSON.stringify(answer));
  }
});

test("only a question that asks for the billing address is taken", () => {
  assert.equal(isBillingAddressQuestion({ id: "billing-address", label: "Home address (for billing)" }), true);
  assert.equal(isBillingAddressQuestion({ id: "q7", label: "Billing address" }), true);
  for (const label of ["Bride Address", "Ceremony location", "Reception venue billing address", "Home address"]) {
    assert.equal(isBillingAddressQuestion({ id: "q", label }), false, label);
  }
});

test("Tiffany's form gives nothing; the same form with the question gives her address", () => {
  const venues = {
    fields: [
      { id: "getting-ready", label: "Bridal prep location" },
      { id: "ceremony-location", label: "Ceremony location" },
    ],
    answers: { "getting-ready": "The Inn, 1 Main St, Morristown, NJ 07960", "ceremony-location": "St Ann's, 2 Elm St, Madison, NJ 07940" },
  };
  assert.equal(billingAddressFromForm(venues), null);
  const withQuestion = {
    fields: [...venues.fields, { id: "billing-address", label: "Home address (for billing)" }],
    answers: { ...venues.answers, "billing-address": "140 Briarwood Rd\nFlorham Park, NJ 07932" },
  };
  assert.deepEqual(billingAddressFromForm(withQuestion)?.address, {
    line1: "140 Briarwood Rd", line2: null, city: "Florham Park", region: "NJ", postalCode: "07932", country: "US",
  });
  // Unreadable, or two that disagree: nothing rather than a guess.
  assert.equal(billingAddressFromForm({ ...withQuestion, answers: { "billing-address": "TBD" } }), null);
});

test("the recommended event form asks it, optionally", () => {
  const details = recommendedQuestionnaires().find((form) => form.id === "wedding-event-details");
  const question = details?.sections.flatMap((section) => section.fields).find((field) => field.id === "billing-address");
  assert.equal(question?.label, "Home address (for billing)");
  assert.equal(question?.required, false);
});

/** Just enough Firestore for the saver: two reads, a transaction, two writes. */
function fakeDb(docs: Record<string, Record<string, unknown> | undefined>) {
  const writes: Array<{ path: string; kind: string; data: Record<string, unknown> }> = [];
  const snap = (path: string) => {
    const data = docs[path];
    return { exists: Boolean(data), get: (key: string) => data?.[key], data: () => data };
  };
  const ref = (path: string) => ({ path, get: async () => snap(path) });
  const db = {
    doc: ref,
    runTransaction: async <T,>(run: (transaction: unknown) => Promise<T>) =>
      run({
        get: async (reference: { path: string }) => snap(reference.path),
        update: (reference: { path: string }, data: Record<string, unknown>) => writes.push({ path: reference.path, kind: "update", data }),
        create: (reference: { path: string }, data: Record<string, unknown>) => writes.push({ path: reference.path, kind: "create", data }),
      }),
  };
  return { db: db as unknown as Firestore, writes };
}

const RESPONSE = {
  tenantId: "t1",
  projectId: "p1",
  status: "submitted",
  answers: { "billing-address": "140 Briarwood Rd\nFlorham Park, NJ 07932" },
  templateSnapshot: { sections: [{ fields: [{ id: "billing-address", label: "Home address (for billing)" }] }] },
};

test("a submitted answer is saved to the job's client, marked as the couple's", async () => {
  const { db, writes } = fakeDb({
    "projects/p1": { tenantId: "t1", clientContactIds: ["c1"] },
    "contacts/c1": { tenantId: "t1", billingAddress: null },
  });
  assert.equal(await saveFormBillingAddress(db, "r1", RESPONSE), "saved");
  const update = writes.find((write) => write.path === "contacts/c1")!;
  assert.equal((update.data.billingAddress as { line1: string }).line1, "140 Briarwood Rd");
  assert.deepEqual(
    { ...(update.data["fieldProvenance.billingAddress"] as Record<string, unknown>), at: "" },
    { source: "couple", label: "Given by the couple on their form", at: "", via: "form", recordId: "r1" },
  );
  assert.ok(writes.some((write) => write.kind === "create" && write.data.action === "contact.billing_address_from_form"));
});

test("never over an address on file, never from a draft, never across studios", async () => {
  const onFile = fakeDb({
    "projects/p1": { tenantId: "t1", clientContactIds: ["c1"] },
    "contacts/c1": { tenantId: "t1", billingAddress: { line1: "1 Studio Set St", city: "Madison" } },
  });
  assert.equal(await saveFormBillingAddress(onFile.db, "r1", RESPONSE), "skipped");
  assert.equal(onFile.writes.length, 0);
  const draft = fakeDb({ "projects/p1": { tenantId: "t1", clientContactIds: ["c1"] }, "contacts/c1": { tenantId: "t1" } });
  assert.equal(await saveFormBillingAddress(draft.db, "r1", { ...RESPONSE, status: "in_progress" }), "skipped");
  const other = fakeDb({ "projects/p1": { tenantId: "t2", clientContactIds: ["c1"] }, "contacts/c1": { tenantId: "t1" } });
  assert.equal(await saveFormBillingAddress(other.db, "r1", RESPONSE), "skipped");
  assert.equal(draft.writes.length + other.writes.length, 0);
});

test("every submitted form runs it, and its failure can't cost the crew brief", () => {
  const trigger = readFileSync("functions/src/planning/crew-brief-trigger.ts", "utf8");
  assert.match(trigger, /await saveFormBillingAddress\(getFirestore\(\), responseId, after\)\.catch\(/);
});
