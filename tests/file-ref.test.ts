import assert from "node:assert/strict";
import test from "node:test";
import {
  FILE_BEARING,
  fileAnswerRefs,
  fileKindOf,
  fileRefsFor,
  refFromPointer,
} from "../features/documents/file-ref.ts";

/**
 * Every file StudioCue holds has to be reachable from its record
 * (docs/document-access-plan-2026-09-28.md). These pin how each pointer shape
 * reads, and that no file-bearing record type from the audit is dropped.
 */

test("a pointer reads the same whichever shape the record stored", () => {
  // Sealed contract: a documents id.
  assert.deepEqual(refFromPointer("signed_contract_c1", "Signed contract"), {
    kind: "document",
    id: "signed_contract_c1",
    label: "Signed contract",
  });
  // Recorded by hand or imported: a raw storage path.
  assert.equal(refFromPointer("tenants/t1/projects/p1/contracts/signed/x.pdf", "Signed")!.kind, "storage");
  // A COI as it arrived: a gs:// URL, which ref() accepts.
  assert.equal(refFromPointer("gs://bucket/coi/1.pdf", "COI")!.kind, "storage");
  // Another service.
  assert.equal(refFromPointer("https://quickbooks.example/inv/1", "Invoice")!.kind, "external");
  assert.equal(refFromPointer("", "Nothing"), null);
  assert.equal(refFromPointer(null, "Nothing"), null);
});

test("a native contract's signed copy and certificate are one file, shown once", () => {
  const files = fileRefsFor("contracts", {
    signedDocumentId: "signed_contract_c1",
    certificateDocumentId: "signed_contract_c1",
  });
  assert.equal(files.length, 1);
  assert.equal(files[0]!.label, "Signed contract");
});

test("a COI opens its filed copy once approved, and the arrival before that", () => {
  const arrived = { temporaryObject: "gs://b/coi.pdf", sourceFilename: "Hiscox COI.pdf" };
  assert.deepEqual(fileRefsFor("insuranceRequests", arrived)[0], {
    kind: "storage",
    path: "gs://b/coi.pdf",
    label: "Hiscox COI.pdf",
    contentType: "application/pdf",
  });
  const approved = { ...arrived, documentId: "coi_r1" };
  assert.equal(fileRefsFor("insuranceRequests", approved)[0]!.kind, "document");
});

test("questionnaire file answers become refs, one or many, and other answers don't", () => {
  const files = fileRefsFor("questionnaireResponses", {
    answers: {
      venue: "Arnold Arboretum",
      shotList: { storagePath: "tenants/t/p/q/shots.pdf", name: "shots.pdf", contentType: "application/pdf" },
      inspiration: [
        { storagePath: "tenants/t/p/q/a.jpg", name: "a.jpg", contentType: "image/jpeg" },
        { storagePath: "tenants/t/p/q/b.jpg", name: "b.jpg" },
      ],
    },
  });
  assert.deepEqual(files.map((file) => file.label), ["shots.pdf", "a.jpg", "b.jpg"]);
  assert.deepEqual(fileAnswerRefs("just text"), []);
});

test("invoices and galleries are links to another service", () => {
  assert.deepEqual(fileRefsFor("invoiceReferences", { hostedUrl: "https://pay.example/1", docNumber: "1042" }), [
    { kind: "external", url: "https://pay.example/1", label: "Invoice 1042" },
  ]);
  assert.deepEqual(fileRefsFor("deliveryRecords", { galleryUrl: "not a url" }), []);
});

test("every file-bearing record type from the audit is covered", () => {
  // Adding a document type without a reader here is how files shipped unlinked.
  assert.deepEqual(Object.keys(FILE_BEARING).sort(), [
    "contracts",
    "crewAssignments",
    "crewProfiles",
    "deliveryRecords",
    "insuranceRequests",
    "invoiceReferences",
    "messages",
    "projectCloseouts",
    "proposals",
    "questionnaireResponses",
    "schedules",
    "studioImportItems",
  ]);
  const samples: Record<keyof typeof FILE_BEARING, Record<string, unknown>> = {
    contracts: { signedDocumentId: "d1" },
    crewAssignments: { requirements: [{ name: "W-9", documentId: "tenants/t/crew/w9.pdf" }] },
    crewProfiles: { w9DocumentPath: "tenants/t/crew/w9.pdf" },
    deliveryRecords: { galleryUrl: "https://pic-time.com/g/1" },
    insuranceRequests: { temporaryObject: "gs://b/coi.pdf" },
    invoiceReferences: { hostedUrl: "https://pay.example/1" },
    messages: { attachmentReferences: [{ storagePath: "tenants/t/m/a.pdf", name: "a.pdf" }] },
    projectCloseouts: { summaryDocumentId: "generated_j1" },
    proposals: { pdfDocumentId: "generated_j2", version: 2 },
    questionnaireResponses: { answers: { f: { storagePath: "tenants/t/q/f.pdf", name: "f.pdf" } } },
    schedules: { pdfDocumentId: "generated_j3" },
    studioImportItems: { storageObjectKey: "tenants/t/imports/contract.docx", name: "Contract.docx" },
  };
  for (const [collection, sample] of Object.entries(samples)) {
    assert.equal(
      fileRefsFor(collection as keyof typeof FILE_BEARING, sample).length,
      1,
      `${collection} should find its file`,
    );
  }
});

test("a file's kind comes from its type or its name", () => {
  assert.equal(fileKindOf("application/pdf"), "pdf");
  assert.equal(fileKindOf("Signed contract.PDF"), "pdf");
  assert.equal(fileKindOf("image/heic"), "image");
  assert.equal(fileKindOf("film.mov"), "video");
  assert.equal(fileKindOf("notes.docx"), "other");
});

test("every list of a file-bearing collection opens its files", async () => {
  // The UI-audit precedent: the questionnaires list read a collection full of
  // answers and uploads, and every row was a bare <article>.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("components/studio/live-domain-view.tsx", "utf8");
  const start = source.indexOf("const configurations");
  const blocks = source.slice(start).split(/\n  [a-z_]+: \{\n/).slice(1);
  const unlinked = blocks
    .map((block) => ({ block, collection: block.match(/collection: "([^"]+)"/)?.[1] ?? "" }))
    .filter(({ collection }) => collection in FILE_BEARING)
    .filter(({ block }) => !/\n    files: /.test(block.split("\n  },")[0] ?? ""))
    .map(({ collection }) => collection);
  assert.deepEqual(unlinked, [], "these lists hold files but show none");
});
