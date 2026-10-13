/**
 * Payment plan walk (docs/planner-journey-plan.md, Phase 4): a wedding on a
 * deposit + 3 installments + final, through StudioCue's real commands in the
 * Functions emulator and its own scheduler code in-process. Emulator only.
 *
 * The composer and the client's screens are walked in the browser between
 * the steps; this script does what a browser can't (sign as the client
 * elsewhere, move the calendar):
 *
 *   setup  <tenant>  a couple account and a job at the consultation, its package on a 3-installment plan
 *   book   <tenant>  the agreement signed and the deposit paid another way (studio commands), so the job books
 *   bill   <tenant> <today>  the daily run's payment-plan pass, as if today were <today>; then drains the PDF jobs
 *   pay    <tenant> <sequence>  installment <sequence> recorded paid (recordInvoicePayment)
 *   amend  <tenant>  an add-on written into a booking change, signed by the studio, applied
 *   report <tenant>  the schedule and the bills as they stand
 *
 *   FIRESTORE_EMULATOR_HOST=… FIREBASE_AUTH_EMULATOR_HOST=… FUNCTIONS_HTTPS_ORIGIN=… \
 *     npx tsx scripts/uat/payment-plan-walk.mts setup <tenant>
 */
import { createRequire } from "node:module";

const REPO = process.cwd();
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)
  throw new Error("Refusing to run without the emulator hosts.");
const projectId = process.env.GCLOUD_PROJECT ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "studiohub-dev";
if (/prod/i.test(projectId)) throw new Error(`Refusing to run against project "${projectId}".`);
const FUNCTIONS = process.env.FUNCTIONS_HTTPS_ORIGIN ?? "http://127.0.0.1:5001/studiohub-dev/us-east4";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(FUNCTIONS)) throw new Error("Refusing to call functions outside the emulator.");
process.env.EMAIL_DELIVERY_MODE = "mock";
process.env.PROVIDER_MOCK_MODE = "true";

const functionsRequire = createRequire(`${REPO}/functions/package.json`);
const { initializeApp } = functionsRequire("firebase-admin/app");
const { getFirestore } = functionsRequire("firebase-admin/firestore");
const { getAuth } = functionsRequire("firebase-admin/auth");
initializeApp({ projectId, storageBucket: process.env.FIREBASE_STORAGE_BUCKET ?? `${projectId}.appspot.com` });
const db = getFirestore();
const auth = getAuth();

const [step, tenantId, arg] = process.argv.slice(2);
if (!step || !tenantId) throw new Error("usage: payment-plan-walk.mts <setup|book|bill|pay|amend|report> <tenantId> [arg]");
const JOB = "plan-job";
const COUPLE_EMAIL = "plan-couple@studiohub.test";
const password = process.env.SEED_DEMO_PASSWORD ?? "";
const nowIso = new Date().toISOString();

type Doc = { id: string; data(): Record<string, unknown>; get(field: string): unknown };

async function idToken(email: string): Promise<string> {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = (await response.json()) as { idToken?: string; error?: unknown };
  if (!body.idToken) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(body.error)}`);
  return body.idToken;
}

async function command(endpoint: string, type: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = await idToken("owner@studiohub.test");
  const response = await fetch(`${FUNCTIONS}/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ type, tenantId, idempotencyKey: `walk-${type}-${Date.now().toString(36)}`, input }),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(`${type}: ${String(payload.error ?? response.status)}`);
  return payload;
}

const invoicesOf = async (): Promise<Doc[]> =>
  (await db.collection("invoiceReferences").where("tenantId", "==", tenantId).where("projectId", "==", JOB).get()).docs;
const accepted = async (): Promise<Doc | null> =>
  (await db.collection("proposals").where("tenantId", "==", tenantId).where("projectId", "==", JOB).where("status", "==", "accepted").get()).docs.sort(
    (a: Doc, b: Doc) => Number(b.get("version") ?? 0) - Number(a.get("version") ?? 0),
  )[0] ?? null;
const money = (cents: unknown) => `$${(Number(cents ?? 0) / 100).toFixed(2)}`;

async function report() {
  const project = await db.doc(`projects/${JOB}`).get();
  const proposal = await accepted();
  console.log(`job ${JOB}: ${project.get("state")} · event ${project.get("eventDate")}`);
  console.log(`accepted proposal ${proposal?.id ?? "—"} v${proposal?.get("version") ?? "?"} hasPaymentPlan=${proposal?.get("hasPaymentPlan")}`);
  for (const line of (proposal?.get("paymentSchedule") as Array<Record<string, unknown>> | undefined) ?? [])
    console.log(`  ${String(line.label).padEnd(16)} ${money(line.amountCents).padStart(10)}  due ${line.dueDate ?? "on signing"}`);
  for (const invoice of (await invoicesOf()).sort((a, b) => String(a.get("createdAt")).localeCompare(String(b.get("createdAt")))))
    console.log(
      `  bill ${invoice.id}: ${invoice.get("kind")}${invoice.get("installmentSequence") ? ` #${invoice.get("installmentSequence")}` : ""} ${invoice.get("status")} ${money(invoice.get("amountCents"))} owed ${money(invoice.get("balanceCents"))} due ${invoice.get("dueDate")} ${invoice.get("number") ?? ""} ${invoice.get("billedBy") ?? invoice.get("provider") ?? "recorded"}`,
    );
}

if (step === "setup") {
  if (!password) throw new Error("SEED_DEMO_PASSWORD is needed for the couple's account.");
  const owner = await auth.getUserByEmail("owner@studiohub.test");
  const couple = await auth.getUserByEmail(COUPLE_EMAIL).catch(() =>
    auth.createUser({ email: COUPLE_EMAIL, password, displayName: "Harper Bennett", emailVerified: true }),
  );
  const audit = { createdAt: nowIso, updatedAt: nowIso, createdBy: owner.uid, updatedBy: owner.uid };
  const batch = db.batch();
  // Named the way the product files a job: "<couple> Wedding" (fixtures-must-match-real-names).
  batch.set(db.doc(`projects/${JOB}`), {
    ...audit, id: JOB, tenantId, projectId: JOB, name: "Harper & Jules Bennett Wedding", eventType: "Wedding", eventTypeId: "wedding",
    eventDate: "2027-06-12", timezone: "America/New_York", state: "CONSULTATION", stateVersion: 0,
    clientContactIds: [`contact-${JOB}`], leadPhotographerId: owner.uid, leadPhotographerName: "Conor Lawless",
    packageSnapshotId: null, venueName: "Harbor View Estate", city: "Gloucester", readinessScore: 10,
    nextAction: "Send the proposal", leadId: null, archivedAt: null, paymentShape: "deposit_and_balance",
  });
  batch.set(db.doc(`contacts/contact-${JOB}`), {
    ...audit, id: `contact-${JOB}`, tenantId, firstName: "Harper", lastName: "Bennett", displayName: "Harper & Jules Bennett",
    email: COUPLE_EMAIL, normalizedEmail: COUPLE_EMAIL, phone: null, normalizedPhone: null, company: null,
    contactTypes: ["client"], projectIds: [JOB], portalUserId: couple.uid, marketingConsent: false, notes: null, archivedAt: null,
  });
  batch.set(db.doc(`users/${couple.uid}`), { ...audit, id: couple.uid, email: COUPLE_EMAIL, displayName: "Harper Bennett", emailVerified: true, archivedAt: null }, { merge: true });
  batch.set(db.doc(`memberships/${tenantId}_${couple.uid}`), {
    ...audit, id: `${tenantId}_${couple.uid}`, tenantId, userId: couple.uid, role: "client", explicitPermissions: [], projectIds: [JOB], status: "active",
  });
  await batch.commit();
  console.log(`setup: ${JOB} at CONSULTATION for ${COUPLE_EMAIL}; package signature-wedding is the one to put on a plan`);
} else if (step === "draft") {
  // The composer's command without the browser: lock the package, then a draft with the studio's own lines.
  await command("crmCommand", "selectPackage", { projectId: JOB, packageId: "signature-wedding", selectedAddOns: [], discount: { type: "none" } }).catch(
    (caught: unknown) => console.log("selectPackage", String(caught)),
  );
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  console.log("create_draft", await command("proposalCommand", "create_draft", {
    projectId: JOB,
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    notes: null,
    termsSummary: "Coverage and deliverables are governed by the completed studio agreement.",
    retainerDueDate: day(1),
    balanceDueDate: "2027-05-29",
    paymentPlan: { installments: [{ dueDate: day(8), amountCents: 100_000 }, { dueDate: "2027-01-15", amountCents: null }, { dueDate: "2027-03-15", amountCents: null }] },
  }));
  await report();
} else if (step === "send-installment") {
  console.log("sendInstallment", await command("bookingCommand", "sendInstallment", { projectId: JOB }).catch((caught: unknown) => String(caught)));
  const { processJobDocument } = await import(`${REPO}/functions/src/operations/jobs.ts`);
  for (const job of (await db.collection("providerJobs").where("tenantId", "==", tenantId).where("projectId", "==", JOB).get()).docs) {
    if (!["queued", "retry_scheduled"].includes(String(job.get("status")))) continue;
    await job.ref.update({ nextAttemptAt: "" });
    await processJobDocument("providerJobs", job.id).catch((caught: unknown) => console.log(String(caught).slice(0, 160)));
    console.log(`  providerJobs/${job.id} → ${(await job.ref.get()).get("status")}`);
  }
  for (const bill of (await invoicesOf()).filter((invoice) => invoice.get("kind") === "installment"))
    console.log(`  ${bill.id}: lines ${JSON.stringify((bill.get("providerLines") as Record<string, unknown> | undefined)?.lines ?? null).slice(0, 300)}`);
  const email = (await db.collection("emailJobs").where("tenantId", "==", tenantId).where("projectId", "==", JOB).get()).docs.find((doc: Doc) => String(doc.id).startsWith("invoice_installment"));
  console.log(`  email ${email?.id}: type ${email?.get("type")}, label ${email?.get("invoiceKindLabel")}`);
  await report();
} else if (step === "record-installment") {
  console.log("recordInstallmentPayment", await command("bookingCommand", "recordInstallmentPayment", {
    projectId: JOB, paidAt: nowIso.slice(0, 10), method: "Check", reference: "1042", attestation: true,
  }).catch((caught: unknown) => String(caught)));
  await report();
} else if (step === "accept") {
  // The draft the composer made (in the browser): approved, and the couple's yes recorded by the studio.
  const draft = (await db.collection("proposals").where("tenantId", "==", tenantId).where("projectId", "==", JOB).get()).docs.find(
    (proposal: Doc) => ["draft", "internal_review", "approved"].includes(String(proposal.get("status"))),
  );
  if (!draft) throw new Error("make the draft in the composer first");
  if (draft.get("status") === "draft") await command("proposalCommand", "submit_for_approval", { proposalId: draft.id });
  if ((await db.doc(`proposals/${draft.id}`).get()).get("status") === "internal_review")
    await command("proposalCommand", "approve", { proposalId: draft.id });
  console.log("record_acceptance", await command("proposalCommand", "record_acceptance", {
    proposalId: draft.id, acceptedBy: "Harper Bennett", acceptedAt: nowIso.slice(0, 10), method: "Said yes on the call", attestation: true,
  }));
  await report();
} else if (step === "book") {
  const proposal = await accepted();
  if (!proposal) throw new Error("accept the proposal first (the studio's 'They said yes' on the proposal page)");
  // BILLING=studio: the studio bills this job itself (own invoicing), so each
  // installment is its own numbered invoice with a PDF.
  if (process.env.BILLING === "studio")
    console.log("setJobBillingMethod", await command("bookingCommand", "setJobBillingMethod", { projectId: JOB, method: "studio" }));
  // The agreement signed elsewhere, as the studio records it; then the deposit, paid another way.
  const project = await db.doc(`projects/${JOB}`).get();
  if (project.get("state") === "CONTRACT_PENDING")
    console.log("recordSignedAgreement", await command("bookingCommand", "recordSignedAgreement", {
      projectId: JOB, proposalId: proposal.id, signerName: "Harper Bennett", signedAt: nowIso.slice(0, 10), method: "Signed on paper at the consultation", attestation: true,
    }));
  const after = await db.doc(`projects/${JOB}`).get();
  console.log("state now", after.get("state"));
  if (after.get("state") === "RETAINER_PENDING")
    console.log("recordRetainerPayment", await command("bookingCommand", "recordRetainerPayment", {
      projectId: JOB, packageSnapshotId: after.get("packageSnapshotId"), paidAt: nowIso.slice(0, 10), method: "Zelle", reference: null, attestation: true,
    }));
  const ready = await db.doc(`projects/${JOB}`).get();
  if (["RETAINER_PENDING", "CONTRACT_PENDING"].includes(String(ready.get("state"))))
    console.log("runBookingGate", await command("bookingCommand", "runBookingGate", {
      projectId: JOB, expectedProjectVersion: Number(ready.get("stateVersion") ?? 0), approvedRetainerExceptionId: null,
    }).catch((caught: unknown) => String(caught)));
  await report();
} else if (step === "bill") {
  const today = arg ?? nowIso.slice(0, 10);
  const { raiseDueInstallments } = await import(`${REPO}/functions/src/operations/installment-billing.ts`);
  await raiseDueInstallments(db, today);
  // The PDFs and emails the bills queued, through the real workers.
  const { processJobDocument } = await import(`${REPO}/functions/src/operations/jobs.ts`);
  for (const collection of ["pdfJobs", "providerJobs"]) {
    const queued = await db.collection(collection).where("tenantId", "==", tenantId).where("status", "in", ["queued", "retry_scheduled"]).get();
    for (const job of queued.docs) {
      if (job.get("projectId") && job.get("projectId") !== JOB) continue;
      // Due now: the walk does not wait out a retry's backoff.
      await job.ref.update({ nextAttemptAt: "" });
      await processJobDocument(collection, job.id).catch((caught: unknown) => console.log(`  ${collection}/${job.id}: ${String(caught).slice(0, 160)}`));
      const done = await db.doc(`${collection}/${job.id}`).get();
      console.log(`  ${collection}/${job.id} → ${done.get("status")}`);
    }
  }
  await report();
} else if (step === "pay") {
  const sequence = Number(arg ?? 1);
  const bill = (await invoicesOf()).find((invoice) => invoice.get("kind") === "installment" && Number(invoice.get("installmentSequence")) === sequence && !["superseded", "voided", "failed"].includes(String(invoice.get("status"))));
  if (!bill) throw new Error(`no installment ${sequence} bill`);
  if (bill.get("billedBy") === "studio" && bill.get("status") === "draft")
    console.log("sendStudioInvoice", await command("bookingCommand", "sendStudioInvoice", { invoiceId: bill.id, via: "email" }).catch((caught: unknown) => String(caught)));
  // The email it queued, through the real sender (mock delivery): what the couple reads.
  const { processJobDocument } = await import(`${REPO}/functions/src/operations/jobs.ts`);
  for (const email of (await db.collection("emailJobs").where("tenantId", "==", tenantId).where("invoiceId", "==", bill.id).get()).docs) {
    await email.ref.update({ nextAttemptAt: "" });
    await processJobDocument("emailJobs", email.id).catch((caught: unknown) => console.log(String(caught).slice(0, 160)));
    const sent = (await db.collection("messages").where("tenantId", "==", tenantId).where("projectId", "==", JOB).get()).docs
      .map((message: Doc) => message.data())
      .filter((message: Record<string, unknown>) => JSON.stringify(message).includes(String(bill.get("number") ?? bill.id)));
    console.log(`email ${email.id} → ${(await email.ref.get()).get("status")}; subject: ${String(sent[0]?.subject ?? "—")}`);
    console.log(`  ${String(sent[0]?.body ?? sent[0]?.bodyText ?? sent[0]?.text ?? "").replace(/\s+/g, " ").slice(0, 400)}`);
  }
  console.log("recordInvoicePayment", await command("bookingCommand", "recordInvoicePayment", {
    projectId: JOB, invoiceId: bill.id, amountCents: Number(bill.get("balanceCents")), paidAt: nowIso.slice(0, 10), method: "Zelle", reference: null, attestation: true,
  }).catch((caught: unknown) => String(caught)));
  await report();
} else if (step === "amend") {
  const project = await db.doc(`projects/${JOB}`).get();
  // A $1,000 extra written into the change, signed by the studio on the couple's word.
  const draft = await command("bookingCommand", "draftAmendment", {
    projectId: JOB,
    eventDate: null,
    keepPackageSnapshotIds: [project.get("packageSnapshotId")],
    extras: [{ packageSnapshotId: project.get("packageSnapshotId"), addOns: [{ addOnId: null, name: "Second shooter for the rehearsal", unitPriceCents: 100_000, taxable: false, quantity: 1 }] }],
  });
  const result = (draft.result ?? draft) as Record<string, unknown>;
  const amendmentId = String(result.amendmentId ?? "");
  console.log("draftAmendment", amendmentId);
  const amendment = await db.doc(`bookingAmendments/${amendmentId}`).get();
  console.log("changes:\n  " + ((amendment.get("changes") as string[] | undefined) ?? []).join("\n  "));
  console.log("recordAmendmentSigned", await command("bookingCommand", "recordAmendmentSigned", {
    amendmentId, signerName: "Harper Bennett", signedAt: nowIso.slice(0, 10), method: "Signed on paper", attestation: true,
  }));
  // Applied by the bookingAmendmentSigned trigger in the emulator; wait for it.
  for (let tries = 0; tries < 30; tries += 1) {
    if ((await db.doc(`bookingAmendments/${amendmentId}`).get()).get("appliedAt")) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log("applied:", JSON.stringify((await db.doc(`bookingAmendments/${amendmentId}`).get()).get("applied")));
  await report();
} else if (step === "final") {
  // The studio sends the final balance by hand (bookingCommand sendFinalBalance).
  console.log("sendFinalBalance", await command("bookingCommand", "sendFinalBalance", { projectId: JOB }).catch((caught: unknown) => String(caught)));
  await report();
} else if (step === "report") {
  await report();
} else throw new Error(`unknown step ${step}`);
process.exit(0);
