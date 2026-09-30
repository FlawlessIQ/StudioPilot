import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { RESEND_SPACING_MS, resendBlockedUntil, signedCopyRetryPlan } from "../functions/src/contracts/resend";
import { selectionDiscount, snapshotDiscountRule } from "../functions/src/pricing/discount-rule";
import { pricePackage } from "../functions/src/pricing/package-price";
import { voidedContractNextAction } from "../functions/src/contracts/commands";
import { renderEmailTemplate, emailTemplateKeys } from "../functions/src/communications/email-templates";
import { validatePreparedAction, STUDIO_ACTION_IDS } from "../functions/src/ai/action-catalog";
import { coupleContract, withdrawnChangeShown, WITHDRAWN_CHANGE_SHOWN_DAYS } from "@/features/contracts/couple-view";
import { discountFromForm, discountLabel, discountRuleOf } from "@/features/proposals/package-discount";
import { signingRefusalCopy } from "@/features/contracts/signing-policy";
import { errorCodeHasCopy, friendlyError } from "@/lib/ai/friendly-error";
import { pendingAmendmentFor } from "@/server/contracts/amendment-signing";

/**
 * Wave 1 — contracts, booking changes and package discounts (2026-09-30).
 *
 * What a couple or a studio could hit after the agreement went out: a change
 * withdrawn in silence, a signature recorded with no confirm and no word to
 * the couple, no way to send anything again, a signed copy or a signed change
 * stuck for good, buttons a coordinator can't use, a discount that couldn't be
 * changed and vanished on a swap, and error copy that named the wrong cause.
 */

const read = (path: string) => readFileSync(path, "utf8");
const brand = {
  studioName: "GR Productions",
  productName: "StudioCue",
  accentColor: "#35664a",
  logoUrl: null,
  contactEmail: "hello@example.com",
};

// ---- 1. Withdrawing a booking change tells the couple ---------------------

test("withdrawing a sent change emails the couple; a draft they never saw doesn't", () => {
  const amendments = read("functions/src/contracts/amendments.ts");
  const cancel = amendments.slice(amendments.indexOf("export async function cancelAmendment"));
  assert.match(cancel, /coupleTold = current\.get\("status"\) === "sent" && Boolean\(clientEmail\)/);
  assert.match(cancel, /if \(coupleTold\)\s*transaction\.set\(db\.doc\(`emailJobs\/amendment_withdrawn_\$\{amendment\.id\}`\)/);
  assert.match(cancel, /type: "amendment_withdrawn"/);
  // The reason stays in the job's history, not in the couple's email.
  assert.doesNotMatch(cancel.slice(0, cancel.indexOf("transaction.update(amendment.ref")), /reason: input\.reason/);
});

test("the withdrawal email lists the change and says the booking stands", () => {
  assert.ok((emailTemplateKeys as readonly string[]).includes("amendment_withdrawn"));
  const email = renderEmailTemplate({
    key: "amendment_withdrawn",
    brand,
    recipientName: "Erin Walsh",
    projectName: "Erin & Joe's wedding",
    values: { changes: ["Wedding date: June 12, 2027 → June 19, 2027", "Adds Highlight Film"], portalUrl: "https://studio-cue.com/client" },
  });
  assert.match(email.subject, /withdrew the change to your booking/);
  assert.match(email.text, /Adds Highlight Film/);
  assert.match(email.text, /stands exactly as it was/);
  assert.match(email.text, /nothing for you to sign/);
  assert.doesNotMatch(email.text, /new one/);
  assert.match(email.html, /<ul class="email-list"/, "two changes render as a list");
});

test("the couple's portal shows a withdrawn change for a while, and never on the home page", async () => {
  const now = Date.parse("2026-09-30T12:00:00Z");
  const change = { status: "cancelled", withdrawnAt: "2026-09-29T12:00:00Z" };
  assert.equal(withdrawnChangeShown(change, now, false), true);
  assert.equal(withdrawnChangeShown(change, now, true), false);
  assert.equal(
    withdrawnChangeShown({ status: "cancelled", withdrawnAt: new Date(now - (WITHDRAWN_CHANGE_SHOWN_DAYS + 1) * 86_400_000).toISOString() }, now, false),
    false,
  );
  assert.equal(withdrawnChangeShown({ status: "sent" }, now, false), false);

  // The portal's read: a change withdrawn after it was sent comes back as
  // withdrawn, with nothing to read or sign; one withdrawn as a draft doesn't.
  const doc = (id: string, data: Record<string, unknown>) => ({ id, get: (field: string) => data[field] });
  const docs = [
    doc("a1", { status: "applied", signingMode: "studiocue", sentAt: "2026-08-01T00:00:00Z", changes: ["Old"] }),
    doc("a2", {
      status: "cancelled",
      signingMode: "studiocue",
      sentAt: "2026-09-20T00:00:00Z",
      cancelledAt: "2026-09-29T12:00:00Z",
      changes: ["Adds Highlight Film"],
      document: { title: "x" },
      documentHash: "f".repeat(64),
    }),
    doc("a3", { status: "cancelled", signingMode: "studiocue", sentAt: null, updatedAt: "2026-09-30T00:00:00Z" }),
  ];
  const query = { where: () => query, limit: () => query, get: async () => ({ docs }) };
  const db = { collection: () => query } as unknown as Firestore;
  const shown = await pendingAmendmentFor(db, "t1", "p1");
  assert.equal(shown?.id, "a2");
  assert.equal(shown?.status, "cancelled");
  assert.equal(shown?.withdrawnAt, "2026-09-29T12:00:00Z");
  assert.equal(shown?.document, null);
  assert.equal(shown?.documentHash, null);
});

test("signing a withdrawn change says it was withdrawn — not that a new one is coming", () => {
  assert.match(read("server/contracts/amendment-signing.ts"), /if \(status === "cancelled"\) throw new SigningRefused\("CHANGE_WITHDRAWN"\)/);
  assert.match(signingRefusalCopy.CHANGE_WITHDRAWN, /stands exactly as it was/);
  assert.doesNotMatch(signingRefusalCopy.CHANGE_WITHDRAWN, /new one/);
  const card = read("components/client/kit/client-booking-change.tsx");
  assert.match(card, /change\.status === "cancelled"/);
  assert.match(card, /withdrew the change to your booking/);
});

test("the studio confirms a withdrawal, may give a reason, and is told the couple hears", () => {
  const panel = read("components/booking/booking-amendment.tsx");
  assert.match(panel, /onClick=\{\(\) => setConfirming\("withdraw"\)\}/);
  assert.match(panel, /reason: withdrawReason\.trim\(\) \|\| null/);
  assert.doesNotMatch(panel, /reason: null \}/, "the reason is no longer always null");
  assert.match(panel, /they're emailed that it was withdrawn/);
});

// ---- 2. Recording a signature: confirm, and the couple is told ------------

test("recording a change's signature asks first and says what it does", () => {
  const panel = read("components/booking/booking-amendment.tsx");
  const record = panel.slice(panel.indexOf('confirming === "record"'));
  assert.match(panel, /onClick=\{\(\) => setConfirming\("record"\)\}/);
  assert.match(record, /can't be undone/);
  assert.match(record, /Crew who said yes are asked to confirm the new day/);
  assert.match(record, /Unpaid invoices written for the old total or date are replaced/);
  // The command runs only from the confirm.
  assert.equal(panel.match(/"recordAmendmentSigned"/g)?.length, 1);
  assert.ok(panel.indexOf('"recordAmendmentSigned"') > panel.indexOf('confirming === "record"'));
});

test("recording a contract signature asks first, names the retired agreement, and is owner/admin only", () => {
  const form = read("components/booking/record-signed-agreement.tsx");
  assert.match(form, /if \(!confirming\) \{\s*setConfirming\(true\);\s*return;/);
  assert.match(form, /they're emailed that there's nothing more to sign/);
  assert.match(form, /workspace\.role !== "studio_owner" && workspace\.role !== "studio_admin"/);
  assert.match(read("components/booking/project-booking-workspace.tsx"), /supersedes=\{Boolean\(/);
});

test("a superseded agreement emails the couple, gets its own card, and the job's next step moves on", () => {
  const booking = read("functions/src/booking/commands.ts");
  const record = booking.slice(booking.indexOf('command.type === "recordSignedAgreement") {'));
  assert.match(record, /emailJobs\/contract_superseded_\$\{outstanding\.id\}/);
  assert.match(record, /type: "contract_superseded"/);
  assert.match(record, /nextAction: "Collect the retainer"/);
  const email = renderEmailTemplate({
    key: "contract_superseded",
    brand,
    recipientName: "Erin Walsh",
    projectName: null,
    values: { portalUrl: "https://studio-cue.com/client" },
  });
  assert.match(email.text, /nothing more for you to sign/);
  assert.match(read("components/client/contract-signing.tsx"), /status === "superseded" \?/);
});

test("the couple's page shows the agreement that stands, not whichever was written last", () => {
  const at = "2026-09-30T12:00:00.000Z";
  // Recording a signature supersedes one and creates another in one batch.
  const superseded = { id: "sc", status: "superseded", updatedAt: at, createdAt: "2026-09-20T00:00:00Z" };
  const recorded = { id: "rec", status: "completed", updatedAt: at, createdAt: at };
  assert.equal(coupleContract([superseded, recorded])?.id, "rec");
  assert.equal(coupleContract([recorded, superseded])?.id, "rec");
  // A signed change files the amended agreement and marks the original.
  const original = { id: "c1", status: "completed", amendedByContractId: "amendment_a", updatedAt: at };
  const amended = { id: "amendment_a", status: "completed", updatedAt: at };
  assert.equal(coupleContract([original, amended])?.id, "amendment_a");
  // A new agreement out beats the withdrawn one; a withdrawn one alone still shows.
  const voided = { id: "v", status: "voided", updatedAt: "2026-09-30T13:00:00Z" };
  const sent = { id: "s", status: "sent", updatedAt: "2026-09-30T12:30:00Z" };
  assert.equal(coupleContract([voided, sent])?.id, "s");
  assert.equal(coupleContract([voided])?.id, "v");
  assert.match(read("components/client/kit/client-contract.tsx"), /coupleContract\(contracts\.value\)/);
});

// ---- 3. Send it again ------------------------------------------------------

test("a contract or a change can be sent again, at most once an hour", () => {
  const now = Date.parse("2026-09-30T12:00:00.000Z");
  assert.equal(resendBlockedUntil(["2026-09-28T09:00:00.000Z", null], now), null);
  assert.equal(resendBlockedUntil(["2026-09-30T11:30:00.000Z"], now), "2026-09-30T12:30:00.000Z");
  // The latest of the original send and the last resend counts.
  assert.equal(resendBlockedUntil(["2026-09-28T09:00:00.000Z", "2026-09-30T11:15:00.000Z"], now), "2026-09-30T12:15:00.000Z");
  assert.equal(resendBlockedUntil(["not a date", undefined], now), null);
  assert.equal(RESEND_SPACING_MS, 3_600_000);
  assert.match(friendlyError(new Error("RESEND_TOO_SOON:2026-09-30T12:30:00.000Z")), /less than an hour ago/);
  assert.match(friendlyError(new Error("RESEND_TOO_SOON:garbage")), /less than an hour ago/);
});

test("resending re-queues the ready email under a new id, owner/admin, and the worker rechecks it", () => {
  const followUps = read("functions/src/contracts/follow-ups.ts");
  assert.match(followUps, /requireOwnerOrAdmin\(context\.membership, "CONTRACT_SIGNING_PERMISSION_REQUIRED"\)/);
  assert.match(followUps, /emailJobs\/\$\{emailJobId\}/);
  assert.match(followUps, /const emailJobId = `contract_ready_\$\{contract\.id\}_again_\$\{count\}`/);
  assert.match(followUps, /type: "contract_ready"/);
  const amendments = read("functions/src/contracts/amendments.ts");
  assert.match(amendments, /const emailJobId = `amendment_ready_\$\{amendment\.id\}_again_\$\{count\}`/);
  assert.match(amendments, /awaitingAmendmentId: input\.amendmentId/);
  const worker = read("functions/src/operations/jobs.ts");
  assert.match(worker, /amendment_no_longer_awaiting_signature/);
  const booking = read("functions/src/booking/commands.ts");
  for (const command of ["resendContract", "resendAmendment", "retrySignedCopy", "retryAmendmentApply"])
    assert.match(booking, new RegExp(`type: z\\.literal\\("${command}"\\)`), command);
});

test("the buttons are there, and Cue can do both", () => {
  assert.match(read("components/contracts/native-contract-step.tsx"), /resendContract\(\{ projectId, contractId: live\.id \}\)/);
  assert.match(read("components/booking/booking-amendment.tsx"), /"resendAmendment"/);
  for (const id of ["resend_contract", "resend_booking_change", "set_package_discount"]) assert.ok(STUDIO_ACTION_IDS.has(id), id);
  const context = {
    allowedProjectIds: new Set(["job-1"]),
    archivedProjectIds: new Set<string>(),
    scopedProjectId: "job-1",
    ownerOrAdmin: false,
  };
  assert.equal(validatePreparedAction({ action: "resend_contract" }, context).ok, false, "a coordinator can't");
  assert.equal(validatePreparedAction({ action: "resend_contract" }, { ...context, ownerOrAdmin: true }).ok, true);
});

// ---- 4. Stuck states get a way out ----------------------------------------

test("a signed copy that gave up can be made again; one on its way is left alone", () => {
  assert.equal(signedCopyRetryPlan({ exists: true, status: "dead_letter" }), "requeue");
  assert.equal(signedCopyRetryPlan({ exists: true, status: "failed" }), "requeue");
  assert.equal(signedCopyRetryPlan({ exists: false, status: undefined }), "create");
  assert.equal(signedCopyRetryPlan({ exists: true, status: "running" }), "in_progress");
  assert.equal(signedCopyRetryPlan({ exists: true, status: "retry_scheduled" }), "in_progress");
  assert.equal(signedCopyRetryPlan({ exists: true, status: "succeeded" }), "done");
  const step = read("components/contracts/native-contract-step.tsx");
  assert.match(step, /doc\(firestore, "pdfJobs", `contract_seal_\$\{liveId\}`\)/);
  assert.match(step, /Make the signed copy again/);
  // The couple's page stops promising "shortly" for good.
  const couple = read("components/client/contract-signing.tsx");
  assert.doesNotMatch(couple, /will be ready to download here shortly/);
  assert.match(couple, /taking longer than usual/);
});

test("a signed change the apply failed on is retried, and the studio can apply it again", () => {
  const apply = read("functions/src/booking/amendment-apply.ts");
  assert.match(apply, /onDocumentWritten\(\s*\{ document: "bookingAmendments\/\{amendmentId\}", retry: true \}/);
  const amendments = read("functions/src/contracts/amendments.ts");
  const retry = amendments.slice(amendments.indexOf("export async function retryAmendmentApply"));
  assert.match(retry, /await applyAmendment\(db, amendment\.id\)/);
  assert.match(retry, /AMENDMENT_APPLY_FAILED/);
  const panel = read("components/booking/booking-amendment.tsx");
  assert.match(panel, /str\(item\.status\) === "signed" && !item\.appliedAt/);
  assert.match(panel, /"retryAmendmentApply"/);
  assert.match(friendlyError(new Error("AMENDMENT_ALREADY_SIGNED")), /Apply it again/);
  assert.doesNotMatch(friendlyError(new Error("AMENDMENT_ALREADY_SIGNED")), /being applied now/);
});

// ---- 5. Coordinators aren't offered owner/admin commands ------------------

test("sign & send, withdraw and send again are hidden from coordinators, with a note", () => {
  const step = read("components/contracts/native-contract-step.tsx");
  assert.match(step, /const ownerOrAdmin = workspace\.role === "studio_owner" \|\| workspace\.role === "studio_admin"/);
  assert.match(step, /status !== "completed" && ownerOrAdmin \? \(\s*<button className="button button-light" onClick=\{\(\) => setVoiding/);
  assert.match(step, /\{!ownerOrAdmin \? \(\s*<p className="native-contract-note">\s*A studio owner or admin signs the contract/);
});

// ---- 6. Voiding moves the job's next step on ------------------------------

test("a withdrawn contract leaves the job asking for a new one, not a signature", () => {
  assert.equal(voidedContractNextAction(undefined), "Prepare a new contract and send it");
  assert.equal(voidedContractNextAction("combined"), "Correct the proposal, or send a new booking agreement");
  const commands = read("functions/src/contracts/commands.ts");
  const voiding = commands.slice(commands.indexOf("export async function voidStudioCueContract"));
  assert.match(voiding, /nextAction: voidedContractNextAction\(contract\.get\("mode"\)\)/);
});

// ---- 7. Discounts ----------------------------------------------------------

test("a snapshot's discount is read as its rule, and legacy amounts stay amounts", () => {
  assert.deepEqual(snapshotDiscountRule({ discountRule: { type: "percentage", basisPoints: 1000 }, discountCents: 42000 }), {
    type: "percentage",
    basisPoints: 1000,
  });
  assert.deepEqual(snapshotDiscountRule({ discountCents: 25000 }), { type: "fixed", amountCents: 25000 });
  assert.deepEqual(snapshotDiscountRule({ discountCents: 0 }), { type: "none" });
  assert.deepEqual(snapshotDiscountRule(null), { type: "none" });
});

test("a swap keeps the discount; an add doesn't invent one; an explicit rule wins", () => {
  const replaced = { discountRule: { type: "percentage", basisPoints: 1000 } };
  assert.deepEqual(selectionDiscount({ type: "keep" }, { replacing: true, replacedSnapshot: replaced }), { type: "percentage", basisPoints: 1000 });
  assert.deepEqual(selectionDiscount({ type: "keep" }, { replacing: false, replacedSnapshot: replaced }), { type: "none" });
  assert.deepEqual(selectionDiscount({ type: "keep" }, { replacing: true, replacedSnapshot: null }), { type: "none" });
  assert.deepEqual(selectionDiscount({ type: "fixed", amountCents: 5000 }, { replacing: true, replacedSnapshot: replaced }), {
    type: "fixed",
    amountCents: 5000,
  });
  // Every package-change caller sends keep now, not none.
  for (const path of ["components/proposals/proposal-packages-panel.tsx", "components/ai/flow-runner.tsx", "components/today/today-inbox.tsx", "components/ai/actions/booking-actions.tsx"])
    assert.doesNotMatch(read(path), /discount: \{ type: "none"/, path);
});

test("adding an extra keeps 10% off at 10%, where it used to freeze into the old amount", () => {
  const rule = snapshotDiscountRule({ discountRule: { type: "percentage", basisPoints: 1000 }, discountCents: 400000 });
  const priced = pricePackage({
    basePriceCents: 4_000_000,
    addOns: [{ unitPriceCents: 500_000, quantity: 1, taxable: true }],
    discount: rule,
    taxRateBasisPoints: 0,
    retainerRule: { type: "fixed", amountCents: 100_000 },
    billedCrew: 1,
  });
  assert.equal(priced.discountCents, 450_000);
  const crm = read("functions/src/crm/commands.ts");
  const addOns = crm.slice(crm.indexOf('if (command.type === "setJobAddOns")'), crm.indexOf('if (command.type === "setPackageDiscount")'));
  assert.match(addOns, /const discountRule = snapshotDiscountRule\(previous\.data\(\)\)/);
  assert.doesNotMatch(addOns, /type: "fixed", amountCents: Number\(previous\.get\("discountCents"\)\)/);
  assert.match(crm, /discountRule: discount,/);
});

test("the Packages panel edits a package's discount and re-prices the proposal", () => {
  assert.deepEqual(discountFromForm("percentage", "12.5"), { ok: true, rule: { type: "percentage", basisPoints: 1250 } });
  assert.deepEqual(discountFromForm("fixed", "$250"), { ok: true, rule: { type: "fixed", amountCents: 25000 } });
  assert.deepEqual(discountFromForm("fixed", ""), { ok: true, rule: { type: "none" } });
  assert.equal(discountFromForm("percentage", "120").ok, false);
  assert.equal(discountLabel({ type: "percentage", basisPoints: 1000 }), "10% off");
  assert.equal(discountLabel({ type: "fixed", amountCents: 25000 }), "$250 off");
  assert.equal(discountLabel(discountRuleOf({ discountCents: 0 })), null);
  const panel = read("components/proposals/proposal-packages-panel.tsx");
  assert.match(panel, /runCrmCommand\("setPackageDiscount", \{ projectId, packageSnapshotId, discount: parsed\.rule \}\)/);
  // Through change(), so it ends in revise_packages like every package change.
  assert.match(panel, /return change\(`discount-\$\{packageSnapshotId\}`/);
  assert.match(read("functions/src/crm/commands.ts"), /type: z\.literal\("setPackageDiscount"\)/);
});

// ---- 8. Confirms that name what's lost ------------------------------------

test("removing a package or extras, and starting over, say what goes", () => {
  const panel = read("components/proposals/proposal-packages-panel.tsx");
  assert.match(panel, /if \(!sentToCouple && loses && !window\.confirm/);
  assert.match(panel, /off the job\$\{\s*extras\.length \? `, with its extras:/);
  assert.match(panel, /takes its extras off/);
  assert.match(panel, /and the price comes down with it/);
  const composer = read("components/proposals/studio-proposal-workspace.tsx");
  assert.match(composer, /Start over with \$\{chosen\}\? This takes \$\{losing\.join\(" and "\)\} off the job/);
  assert.match(composer, /Take \$\{text\(extra\?\.packageName, "this package"\)\} off the job\?/);
});

// ---- 9. Cue's "Add and revise" is retry-safe -------------------------------

test("Cue's Add and revise carries on when its first attempt already re-priced", () => {
  const cue = read("components/ai/actions/booking-actions.tsx");
  const card = cue.slice(cue.indexOf("export function PackageRequestCard"), cue.indexOf("function in14Days"));
  assert.match(card, /if \(!packageChangeAlreadyApplied\(caught\)\) throw caught;/);
  assert.match(card, /if \(!proposalAlreadyRevised\(caught\)\) throw caught;/);
});

// ---- 10. Error copy names the true cause ----------------------------------

test("every new code reads as English, and the old ones say what actually happened", () => {
  for (const code of [
    "AMENDMENT_WITHDRAWN",
    "AMENDMENT_CHANGED",
    "AMENDMENT_FIELDS_MISSING",
    "AMENDMENT_CLIENT_EMAIL_REQUIRED",
    "AMENDMENT_NOT_SENT",
    "AMENDMENT_NOT_SIGNED",
    "AMENDMENT_APPLY_FAILED",
    "CONTRACT_NOT_AWAITING_SIGNATURE",
    "AGREEMENT_PRICES_EXPIRED",
    "SIGNED_COPY_NOT_EXPECTED",
    "RESEND_TOO_SOON",
    "CHANGE_WITHDRAWN",
    "AGREEMENT_ALREADY_SENT",
  ])
    assert.ok(errorCodeHasCopy(code), code);
  // Thrown when the job isn't at CONTRACT_PENDING — not about a "ready proposal".
  assert.match(friendlyError(new Error("CONTRACT_NOT_READY")), /isn't waiting for its agreement/);
  assert.match(friendlyError(new Error("AMENDMENT_NOT_DRAFT")), /Send it again/);
  assert.match(friendlyError(new Error("AGREEMENT_ALREADY_SENT:signed")), /Change the booking/);
  assert.match(friendlyError(new Error("AGREEMENT_ALREADY_SENT:provider")), /signing app/);
  assert.match(friendlyError(new Error("AGREEMENT_ALREADY_SENT")), /Booking tab/);
  // sendAmendment has its own codes now, not the contract's.
  const amendments = read("functions/src/contracts/amendments.ts");
  const send = amendments.slice(amendments.indexOf("export async function sendAmendment"), amendments.indexOf("export async function recordAmendmentSigned"));
  assert.doesNotMatch(send, /"CONTRACT_CHANGED"|"CONTRACT_FIELDS_MISSING"|"CLIENT_EMAIL_REQUIRED"/);
  assert.match(amendments, /if \(status === "cancelled"\) throw new Error\("AMENDMENT_WITHDRAWN"\)/);
  // The booking page's dead map (it looked up already-translated text) is gone.
  const workspace = read("components/booking/project-booking-workspace.tsx");
  assert.doesNotMatch(workspace, /known\[message\]/);
});
