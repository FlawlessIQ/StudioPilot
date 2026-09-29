import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pricingClauses } from "@/features/contracts/pricing-clauses";

/**
 * H2 slice 4 (docs/proposal-agreement-and-addons-plan-2026-09-28.md): a studio
 * uploads its own contract on the agreement editor, and any line that states
 * a price of its own is flagged — the proposal sets the price now.
 */

test("a line with its own price is flagged; a line with a price field is not", () => {
  const body = [
    "WEDDING PHOTOGRAPHY AGREEMENT",
    "The total fee for the Services is $4,500.00, payable as below.",
    "A non-refundable retainer of {{price.retainer}} secures the date.",
    "The balance of {{price.balance}} is due 14 days before the event.",
    "A 30% retainer is due at signing.",
    "Travel beyond 50 miles is billed at 0.65 USD per mile.",
    "Coverage runs for 8 hours.",
  ].join("\n");
  assert.deepEqual(
    pricingClauses(body).map((clause) => clause.line),
    [2, 5, 6],
  );
});

test("the editor offers the upload itself, and reads the file through the import pipeline", () => {
  const editor = readFileSync("components/contracts/agreement-editor.tsx", "utf8");
  assert.match(editor, /Upload your contract/);
  assert.match(editor, /uploadStudioImportFiles\(\{ files: \[file\] \}\)/);
  assert.match(editor, /convertImportedAgreement\(text\)/);
  // The session is closed, so it doesn't wait in the import queue.
  assert.match(editor, /cancelStudioImport\(sessionId\)/);
  assert.match(editor, /pricingClauses\(body\)/);
});

test("a contract imported the first time becomes an agreement the editor offers", () => {
  const review = readFileSync("functions/src/studio-import/review.ts", "utf8");
  const firstActivation = review.slice(review.indexOf('if (assetType === "package") {\n        const packageId'));
  assert.match(firstActivation, /if \(assetType === "contract"\) \{\s*const templateId = `imported_agreement_\$\{assetId\}`;\s*transaction\.set\(/);
});

test("a flattened upload gets its numbered clauses and title back, and the flag quotes the priced sentence", async () => {
  const { convertImportedAgreement } = await import("@/features/contracts/document");
  // Walked on prod 2026-09-29: an uploaded contract came back as one line.
  const flat =
    'PHOTOGRAPHY SERVICES AGREEMENT This agreement is between [Studio Name] and [Client Names] for coverage on [Event Date]. 1. Services. Up to eight hours of coverage. 2. Fees. The total fee for the Services is $4,500.00. The balance is due fourteen days before the event. 3. Cancellation. The retainer is kept. 4. Image rights. Photographer keeps copyright.';
  const converted = convertImportedAgreement(flat);
  assert.equal(converted.title, "Photography Services Agreement");
  assert.equal(converted.clausesRestored, 4);
  assert.match(converted.body, /\n\n\*\*4\. Image rights\.\*\* Photographer/);
  const flags = pricingClauses(converted.body);
  assert.equal(flags.length, 1);
  assert.match(flags[0]!.text, /^\*\*2\. Fees\.\*\* The total fee for the Services is \$4,500\.00\./);
});
