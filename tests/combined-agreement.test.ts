import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCombinedAgreement,
  sectionDocument,
  sectionsValid,
  COMBINED_SECTION_TITLES,
} from "@/features/contracts/combined";
import type { ContractDocument } from "@/features/contracts/document";
import { combinedAgreementOn } from "@/features/contracts/rollout";
import { contractDocumentHash } from "@/server/contracts/document-hash";

/**
 * One send, two signatures (H2 Part B,
 * docs/proposal-agreement-and-addons-plan-2026-09-28.md): the studio's terms
 * and the couple's coverage in one agreement, each part signed, and signing
 * it accepts the proposal.
 */

const MARKER = "// ── mirrored below ──";
const body = (path: string) => {
  const source = readFileSync(path, "utf8");
  return source.slice(source.indexOf(MARKER));
};

const terms: ContractDocument = {
  format: 1,
  title: "Photography agreement",
  blocks: [
    { type: "paragraph", content: [{ text: "This agreement is between the Studio and the Client." }] },
    { type: "heading", level: 2, content: [{ text: "Cancellation" }] },
    { type: "paragraph", content: [{ text: "The retainer is non-refundable." }] },
  ],
};

const coverage = {
  currency: "USD",
  lineItems: [
    { description: "Silver Cinematic Package", quantity: 1, totalCents: 299900, kind: "package" },
    { description: "Engagement session", quantity: 1, totalCents: 45000, kind: "add_on" },
    { description: "Extra hour", quantity: 2, totalCents: 60000, kind: "add_on" },
  ],
  discountCents: 10000,
  taxCents: 0,
  totalCents: 394900,
  paymentSchedule: [
    { label: "Retainer", amountCents: 100000, dueDate: null },
    { label: "Final balance", amountCents: 294900, dueDate: "2027-05-29" },
  ],
};

test("the functions copy is the same module", () => {
  assert.equal(body("functions/src/contracts/combined.ts"), body("features/contracts/combined.ts"));
});

test("the agreement is the terms, then the coverage, and the parts tile it exactly", () => {
  const { document, sections } = buildCombinedAgreement(terms, coverage);
  assert.equal(document.title, "Photography agreement");
  assert.ok(sectionsValid(document, sections));
  assert.deepEqual(
    sections.map((section) => section.key),
    ["terms", "coverage"],
  );
  const part1 = sectionDocument(document, sections[0]!);
  const part2 = sectionDocument(document, sections[1]!);
  assert.equal(part1.blocks.length, terms.blocks.length + 1, "Part 1 is the studio's text under its heading");
  const text = JSON.stringify(part2.blocks);
  assert.match(text, new RegExp(COMBINED_SECTION_TITLES.coverage));
  assert.match(text, /Silver Cinematic Package — \$2,999/);
  assert.match(text, /"Extras"/);
  assert.match(text, /Extra hour × 2 — \$600/);
  assert.match(text, /Discount: −\$100/);
  assert.match(text, /Total: \$3,949/);
  assert.ok(part2.blocks.some((block) => block.type === "payment_schedule"));
  // Tampering with the tiling is refused.
  assert.equal(sectionsValid(document, [sections[1]!, sections[0]!]), false);
  assert.equal(sectionsValid(document, [{ ...sections[0]!, end: 1 }, sections[1]!]), false);
});

test("each part has its own hash, and a change to the price changes Part 2's and the whole", () => {
  const a = buildCombinedAgreement(terms, coverage);
  const b = buildCombinedAgreement(terms, { ...coverage, totalCents: 404900 });
  const hash = (built: typeof a, index: number) => contractDocumentHash(sectionDocument(built.document, built.sections[index]!));
  assert.equal(hash(a, 0), hash(b, 0), "the terms are unchanged");
  assert.notEqual(hash(a, 1), hash(b, 1), "the coverage is not");
  assert.notEqual(contractDocumentHash(a.document), contractDocumentHash(b.document));
});

test("it is off unless the studio has native signing and the flag", () => {
  assert.equal(combinedAgreementOn(null), false);
  assert.equal(combinedAgreementOn({ combinedAgreement: true }), false, "needs native signing");
  assert.equal(combinedAgreementOn({ nativeContractSigning: true }), false);
  assert.equal(combinedAgreementOn({ nativeContractSigning: true, combinedAgreement: true }), true);
  const commands = readFileSync("functions/src/contracts/combined-commands.ts", "utf8");
  assert.match(commands, /throw new Error\("COMBINED_AGREEMENT_NOT_ENABLED"\)/);
});

test("the studio signs both parts at send, and the send refuses text it didn't read", () => {
  const commands = readFileSync("functions/src/contracts/combined-commands.ts", "utf8");
  assert.match(commands, /requireOwnerOrAdmin\(context\.membership/);
  assert.match(commands, /if \(resolved\.documentHash !== input\.documentHash\) throw new Error\("CONTRACT_CHANGED"\)/);
  assert.match(commands, /`\$\{contractId\}_studio_\$\{section\.key\}`/);
  assert.match(commands, /mode: "combined"/);
  // The proposal goes out inside the agreement, with no email of its own.
  assert.match(commands, /combinedContractId: contractId/);
  assert.match(commands, /combined: true,/);
});

test("the couple signs both parts in one act that accepts the proposal and signs the contract", () => {
  const signing = readFileSync("server/contracts/combined-signing.ts", "utf8");
  // Both parts or neither.
  assert.match(signing, /if \(!typedNameTerms \|\| !typedNameCoverage\) throw new SigningRefused\("NAME_REQUIRED"\)/);
  // Each part's hash is checked against the stored text.
  assert.match(signing, /contractDocumentHash\(sectionDocument\(document, section\)\) !== section\.hash/);
  // The proposal decision rules and the contract signing policy both apply.
  assert.match(signing, /planClientProposalDecision\(\{/);
  assert.match(signing, /projectState: "CONTRACT_PENDING",/);
  // Only the latest version of the proposal can be accepted this way.
  assert.match(signing, /if \(latest\.docs\[0\]\?\.id !== proposalId\) throw new SigningRefused\("DOCUMENT_CHANGED"\)/);
  // Two recorded state changes, one write.
  assert.match(signing, /state: "RETAINER_PENDING",\s*stateVersion: priorStateVersion \+ 2/);
  assert.match(signing, /audit\("state_accepted"/);
  assert.match(signing, /audit\("state_signed"/);
  const route = readFileSync("app/api/client/portal/route.ts", "utf8");
  assert.match(route, /type: z\.literal\("sign_combined_agreement"\)/);
  // Accepting it on its own would move the job past where it can be signed.
  assert.match(route, /if \(decision === "accepted" && proposal\.get\("combinedContractId"\)\)/);
  // The acceptance trigger leaves a signed booking agreement alone.
  const orchestration = readFileSync("functions/src/booking/orchestration.ts", "utf8");
  assert.match(orchestration, /if \(proposal\.get\("acceptedWithContractId"\)\) return;/);
});

test("the sealed PDF groups each signature under the part it signs", () => {
  const seal = readFileSync("functions/src/contracts/seal.ts", "utf8");
  assert.match(seal, /section_hash: text\(signature\.get\("sectionHash"\)\) \|\| null/);
  const renderer = readFileSync("cloud-run/pdf/contract.py", "utf8");
  assert.match(renderer, /section_hash: str \| None = Field\(default=None/);
  assert.match(renderer, /\["Part fingerprint \(SHA-256\)", signature\.section_hash or "—"\]/);
});

test("Part 2 dates its payments as Part 1 does", () => {
  const { document, sections } = buildCombinedAgreement(terms, coverage);
  const part2 = JSON.stringify(sectionDocument(document, sections[1]!).blocks);
  assert.match(part2, /May 29, 2027/);
  assert.doesNotMatch(part2, /2027-05-29/);
});

test("the proposal's delivery line follows the agreement's email", () => {
  const commands = readFileSync("functions/src/contracts/combined-commands.ts", "utf8");
  assert.match(commands, /emailJobId: `contract_ready_\$\{contractId\}`,\s*emailDeliveryStatus: "queued"/);
  assert.match(commands, /proposalId: input\.proposalId,\s*type: "contract_ready"/);
});

test("a proposal inside a live booking agreement can't be resent, re-issued or accepted on its own", () => {
  const proposals = readFileSync("functions/src/booking/proposals.ts", "utf8");
  assert.match(proposals, /\["resend", "reissue", "record_acceptance", "send"\]\.includes\(command\.type\)/);
  assert.match(proposals, /throw new Error\("PROPOSAL_IN_BOOKING_AGREEMENT"\)/);
  const workspace = readFileSync("components/proposals/studio-proposal-workspace.tsx", "utf8");
  assert.match(workspace, /\{proposal\.combinedContractId \? \(/);
});

test("the sent proposal's panel is rendered once", () => {
  const workspace = readFileSync("components/proposals/studio-proposal-workspace.tsx", "utf8");
  // A scripted edit once duplicated the whole panel (acee781): every line of
  // it appeared twice on the page.
  assert.equal(workspace.split('className="proposal-delivery-state"').length - 1, 1);
});

test("the couple's portal is sent what the booking agreement screens check", () => {
  // Walked on prod 2026-09-30: without these the couple got the one-signature
  // form, which is refused while the job is at PROPOSAL.
  const route = readFileSync("app/api/client/portal/route.ts", "utf8");
  const contracts = route.slice(route.indexOf("  contracts: ["), route.indexOf("  invoiceReferences: ["));
  for (const field of ['"mode"', '"sections"', '"proposalId"']) assert.ok(contracts.includes(field), field);
  const proposals = route.slice(route.indexOf("  proposals: ["), route.indexOf("  packageSnapshots: ["));
  assert.ok(proposals.includes('"combinedContractId"'));
  // And the signing screen branches on exactly those.
  const signing = readFileSync("components/client/contract-signing.tsx", "utf8");
  assert.match(signing, /contract\.mode === "combined" && Array\.isArray\(contract\.sections\)/);
});

test("asking for changes withdraws the booking agreement with the proposal", () => {
  const route = readFileSync("app/api/client/portal/route.ts", "utf8");
  assert.match(route, /decision === "declined" && combinedContractId/);
  assert.match(route, /action: "contract\.withdrawn_for_changes"/);
});

test("a couple sitting on a booking agreement is reminded, until its prices lapse", () => {
  const reminders = readFileSync("functions/src/contracts/reminders.ts", "utf8");
  assert.match(reminders, /project\.get\("state"\) !== \(combined \? "PROPOSAL" : "CONTRACT_PENDING"\)/);
  assert.match(reminders, /expiresAt <= Date\.now\(\)\) continue;/);
});

test("while a booking agreement is out, the job says so — and doesn't offer to record an acceptance", async () => {
  const { projectJourney } = await import("@/features/journey/steps");
  const base = {
    projectId: "p1",
    state: "PROPOSAL",
    eventDate: "2027-10-09",
    today: "2026-09-30",
    lead: { id: "l1", status: "converted" },
    hasConsultation: true,
    proposalStatus: "sent",
    contractStatus: "sent",
    retainerInvoiceStatus: null,
    finalInvoiceStatus: null,
    questionnaireStatus: null,
    questionnaireHasAnswers: false,
    scheduleStatus: null,
    scheduleHasUsableItems: false,
    crewAccepted: 0,
    crewCascadeActive: false,
    coiStatus: null,
    insuranceRequired: null,
    dayBeforeDraftStatus: null,
    hasDelivery: false,
    albumOrReviewDone: false,
  } as const;
  const step = (input: Record<string, unknown>) =>
    projectJourney(input as never).steps.find((item) => item.key === "proposal");
  assert.equal(step(base)?.title, "Proposal");
  assert.equal(step({ ...base, bookingAgreementOut: true })?.title, "Booking agreement");
  assert.match(String(step({ ...base, bookingAgreementOut: true })?.detail), /signing both parts accepts the proposal/);
  const detail = readFileSync("components/projects/live-project-detail.tsx", "utf8");
  assert.match(detail, /if \(bookingAgreementOut && state === "PROPOSAL"\) return null;/);
});

test("the proposal page guards its actions only while the booking agreement is live", () => {
  const source = readFileSync("components/proposals/studio-proposal-workspace.tsx", "utf8");
  assert.match(source, /combinedAgreementLive\(proposal, contracts\.records\)/);
  assert.match(source, /\["sent", "viewed"\]\.includes\(text\(contract\.status/);
});

test("the job's open-items list names a booking agreement, not vendor evidence", () => {
  const source = readFileSync("features/projects/lifecycle-projection.ts", "utf8");
  assert.match(source, /"Sign the booking agreement"/);
  assert.doesNotMatch(source, /detail: `[^`]*provider evidence pending/);
});

test("a live booking agreement can be withdrawn from the Booking tab and from Cue", () => {
  const booking = readFileSync("components/booking/project-booking-workspace.tsx", "utf8");
  assert.match(booking, /nativeActive && \(proposal \|\| combinedOut\)/);
  assert.match(booking, /\{proposal && contract\?\.status !== "completed" \? \(/);
  const cue = readFileSync("components/ai/actions/booking-actions.tsx", "utf8");
  assert.match(cue, /str\(contract\?\.mode\) === "combined"/);
  const hero = readFileSync("components/booking/booking-autopilot-workspace.tsx", "utf8");
  assert.match(hero, /The booking agreement is with the client\./);
});

test("the agreement states the retainer the schedule bills, not the package's percentage", () => {
  const sources = readFileSync("functions/src/contracts/sources.ts", "utf8");
  assert.match(sources, /retainerCents: retainerFromSchedule\(proposal\.get\("paymentSchedule"\), cents\(pricing\.retainerCents\)\)/);
  const cue = readFileSync("components/ai/actions/booking-actions.tsx", "utf8");
  assert.match(cue, /dollars\(retainerFromSchedule\(proposal\?\.paymentSchedule/);
});

test("a withdrawn agreement before acceptance hands the Booking tab back to the proposal", () => {
  const booking = readFileSync("components/booking/project-booking-workspace.tsx", "utf8");
  assert.match(booking, /const shownContract =\s*contract && \(proposal \|\| !\["voided", "superseded", "declined"\]/);
  assert.match(booking, /\) : shownContract \? \(\s*<div className="booking-evidence">/);
  assert.doesNotMatch(booking, /formatDueDate\(String\((shown)?[cC]ontract\.sentAt\)\)/);
});
