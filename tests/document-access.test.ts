import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  signedCopyDocument,
  signedCopyDocumentId,
  signedCopyPrefix,
} from "../functions/src/contracts/signed-copy-document.ts";
import { projectJourney } from "../features/journey/steps.ts";

/**
 * H1 — documents open in one click, everywhere
 * (docs/document-access-plan-2026-09-28.md).
 */
const read = (path: string) => readFileSync(path, "utf8");

test("a hand-recorded or imported signed copy is filed as a document", () => {
  const document = signedCopyDocument({
    tenantId: "t1",
    projectId: "p1",
    contractId: "c1",
    path: "tenants/t1/projects/p1/contracts/0f8fad5b-d9cb-469f-a165-70867728950e-Harper signed.pdf",
    authority: "manual_attested",
    actorId: "u1",
    now: "2026-09-29T20:00:00.000Z",
  });
  assert.equal(document.id, "signed_contract_c1");
  assert.equal(document.data.name, "Harper signed.pdf");
  assert.equal(document.data.contentType, "application/pdf");
  assert.equal(document.data.providerFileId, "tenants/t1/projects/p1/contracts/0f8fad5b-d9cb-469f-a165-70867728950e-Harper signed.pdf");
  // The couple's own contract, shared by default (Q6).
  assert.equal(document.data.visibility, "client");
  assert.equal(document.data.clientVisible, true);
  assert.equal(signedCopyDocumentId("c1"), "signed_contract_c1");
  assert.equal(signedCopyPrefix("t1", "p1"), "tenants/t1/projects/p1/contracts/");
});

test("both attach paths write the record and point the contract at it", () => {
  const booking = read("functions/src/booking/commands.ts");
  assert.match(booking, /signedDocumentId: signedCopyPath \? signedCopyDocumentId\(contractId\) : null,/);
  assert.match(booking, /authority: "manual_attested",/);
  // The hand-recorded path now checks the folder, as the import path did.
  assert.match(booking, /!signedCopyPath\.startsWith\(signedCopyPrefix\(command\.tenantId, command\.input\.projectId\)\)/);
  const imports = read("functions/src/imports/commands.ts");
  assert.match(imports, /authority: "imported",/);
  assert.match(imports, /signedDocumentId: document\.id,/);
});

test("the journey carries each step's files and its specific record", () => {
  const base = {
    projectId: "p1",
    state: "BOOKED",
    eventDate: "2027-06-12",
    today: "2026-09-29",
    lead: null,
    hasConsultation: true,
    proposalStatus: "accepted",
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
    insuranceRequired: null,
    dayBeforeDraftStatus: null,
    hasDelivery: false,
    albumOrReviewDone: false,
  };
  const { steps } = projectJourney({
    ...base,
    evidence: {
      proposal: { href: "/studio/proposals/pr1", files: [{ kind: "document", id: "generated_j1", label: "Proposal" }] },
      contract: { files: [{ kind: "document", id: "signed_contract_c1", label: "Signed contract" }] },
    },
  });
  const proposal = steps.find((step) => step.key === "proposal")!;
  assert.equal(proposal.record?.href, "/studio/proposals/pr1");
  assert.equal(proposal.files[0]?.label, "Proposal");
  assert.equal(steps.find((step) => step.key === "contract")!.files.length, 1);
  // Without evidence nothing changes: the list page, and no files.
  const plain = projectJourney(base).steps.find((step) => step.key === "proposal")!;
  assert.equal(plain.record?.href, "/studio/proposals?project=p1");
  assert.deepEqual(plain.files, []);
});

test("the history's moments carry their files and open their own record", () => {
  const thread = read("features/journey/thread.ts");
  assert.match(thread, /title: "Agreement fully signed",[\s\S]{0,200}files: FILE_BEARING\.contracts\(contract\)/);
  assert.match(thread, /href: `\/studio\/invoices\?project=\$\{input\.projectId\}`/);
  assert.match(thread, /href: `\/studio\/questionnaires\/\$\{response\.id\}`/);
  assert.match(thread, /href: `\/studio\/schedules\/\$\{schedule\.id\}`/);
});

test("a questionnaire opens as a page of its own", () => {
  assert.match(read("components/studio/live-domain-view.tsx"), /href: \(record\) => `\/studio\/questionnaires\/\$\{record\.id\}`/);
  assert.match(read("app/studio/questionnaires/[id]/page.tsx"), /QuestionnaireResponseView/);
});

test("one viewer: the documents page and every chip resolve files the same way", () => {
  assert.match(read("components/documents/live-document-viewer.tsx"), /resolveFile\(/);
  assert.match(read("components/documents/file-link.tsx"), /resolveFile\(file, workspace\.tenantId \?\? null\)/);
  assert.match(read("lib/contracts/command-client.ts"), /getDownloadURL\(ref\(studioStorage\(\), path\)\)/);
});

test("on a phone a file opens in a new tab, opened before the await", () => {
  const chip = read("components/documents/file-link.tsx");
  const phone = chip.slice(chip.indexOf("if (phone) {"));
  assert.ok(phone.indexOf('window.open("", "_blank")') < phone.indexOf("await resolveFile"));
});

test("crew paperwork, message attachments and import sources open in place", () => {
  assert.match(read("components/studio/live-record-detail.tsx"), /requirementFile\(item\) \? <FileLink file=\{requirementFile\(item\)!\} \/> : null/);
  assert.match(read("components/communications/message-inbox.tsx"), /files: FILE_BEARING\.messages\(value\),/);
  assert.match(read("functions/src/studio-import/review.ts"), /storageObjectKey: string\(item\.get\("storageObjectKey"\)\) \|\| null,/);
});
