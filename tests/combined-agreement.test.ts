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
