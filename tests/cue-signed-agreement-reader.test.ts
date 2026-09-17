import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  attachmentReadiness,
  cueAttachmentPrefix,
} from "../functions/src/ai/signed-agreement.ts";

/**
 * What Cue may do with a signed agreement dropped into it — and what it may not.
 *
 * The feature exists to save a studio typing a PDF into a form. The
 * temptation it creates is to save them the button too: Cue has read the
 * names, matched the job, the command is right there. That would make a model
 * the thing that marks a couple's booking signed, which is exactly what
 * CLAUDE.md forbids ("AI output may never write … signature") and what the
 * booking gate's evidence rules exist to prevent.
 *
 * So these hold three lines:
 *  - Cue reads, and records nothing. The recording is the studio's own
 *    command, run from the card, under their identity.
 *  - Cue never reads a file the malware scan has not cleared.
 *  - Cue reads only from the caller's own staging folder, so a valid request
 *    cannot aim it at another member's file or any other object in the bucket.
 */
const reader = readFileSync(
  `${process.cwd()}/functions/src/ai/signed-agreement.ts`,
  "utf8",
);
// Comments explain the boundary by naming the command; only code counts.
const code = reader
  .replace(/\/\*[\s\S]*?\*\//g, "")
  // A line comment starts a line or follows whitespace — never "gs://".
  .replace(/(^|\s)\/\/.*$/gm, "$1");

test("the reader records nothing", () => {
  assert.doesNotMatch(
    code,
    /recordSignedAgreement\s*\(/,
    "Cue is recording the signature itself instead of prefilling the form",
  );
  // It reads Firestore and deletes its own staged file. It writes no document.
  assert.doesNotMatch(
    code,
    /\.(set|update|create)\s*\(/,
    "the reader writes a document — readings belong in aiInteractions, written by the handler",
  );
  assert.doesNotMatch(code, /runTransaction|\.batch\s*\(/);
});

test("a file the scan hasn't cleared is never read", () => {
  const pdf = "application/pdf";
  assert.deepEqual(attachmentReadiness({ scanStatus: undefined, contentType: pdf }), {
    ready: false,
    result: { status: "scanning" },
  });
  assert.deepEqual(attachmentReadiness({ scanStatus: "pending", contentType: pdf }), {
    ready: false,
    result: { status: "scanning" },
  });
  assert.deepEqual(attachmentReadiness({ scanStatus: "infected", contentType: pdf }), {
    ready: false,
    result: { status: "blocked", reason: "unsafe" },
  });
  // An unavailable scanner is not a pass.
  assert.deepEqual(
    attachmentReadiness({ scanStatus: "scanner_unavailable", contentType: pdf }),
    { ready: false, result: { status: "blocked", reason: "scanner_unavailable" } },
  );
  // Clean, but not something a model should be handed as a document.
  assert.deepEqual(
    attachmentReadiness({ scanStatus: "clean", contentType: "text/html" }),
    { ready: false, result: { status: "blocked", reason: "unsupported" } },
  );
  assert.deepEqual(attachmentReadiness({ scanStatus: "clean", contentType: pdf }), {
    ready: true,
  });
});

test("Cue reads only from the caller's own staging folder", () => {
  assert.equal(
    cueAttachmentPrefix("tenant-a", "owner-a"),
    "tenants/tenant-a/cueAttachments/owner-a/",
  );
  // The guard runs before any read, against the caller's uid, and the model is
  // only ever given the path that passed it.
  const guard = code.indexOf("startsWith(cueAttachmentPrefix(input.tenantId, input.userId))");
  assert.ok(guard >= 0, "the path guard is gone");
  assert.ok(guard < code.indexOf("bucket.file("), "the file is opened before the path is checked");
  assert.match(code, /fileUri: `gs:\/\/\$\{bucket\.name\}\/\$\{input\.attachmentPath\}`/);
});

test("reading is held to the permission of what it leads to", () => {
  const copilot = readFileSync(
    `${process.cwd()}/functions/src/ai/copilot.ts`,
    "utf8",
  );
  const start = copilot.indexOf('kind === "read_signed_agreement"');
  assert.ok(start >= 0, "the read branch is gone");
  const branch = copilot.slice(start, copilot.indexOf('kind === "proposal_drafting"', start));
  // The same two roles recordSignedAgreement accepts, and the same refusal.
  assert.match(branch, /\["studio_owner", "studio_admin"\]/);
  assert.match(branch, /SIGNATURE_ATTESTATION_PERMISSION_REQUIRED/);
  assert.match(branch, /requireActiveSubscription/);
  // What is kept of a reading is what was concluded, not the document.
  assert.match(branch, /type: "signed_agreement_reading"/);
  assert.doesNotMatch(branch, /signerNames|clientNames|signedDate/);
});
