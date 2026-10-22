import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { pendingInquiryOutcome, PENDING_INQUIRY_MAX_ATTEMPTS } from "../functions/src/crm/pending-inquiries.ts";
import { heldInquiryId, heldInquiryReceipt } from "../server/intake/hold-inquiry";

/**
 * 2026-10-22: no function could start for over an hour, and the public form
 * told two people "Your inquiry could not be submitted". The website now holds
 * an inquiry the function can't take, and a scheduler delivers it.
 */
const read = (path: string) => readFileSync(path, "utf8");

test("the relay holds an inquiry when the form function answers 5xx or not at all", () => {
  const relay = read("app/api/functions/[functionName]/route.ts");
  assert.match(relay, /const holdable = functionName === "publicLeadIntake" && request\.method === "POST"/);
  assert.match(relay, /if \(holdable && upstream\.status >= 500\)/);
  assert.match(relay, /if \(!holdable\) throw caught;[\s\S]*?return hold\("unreachable"\)/);
  // Held only with App Check, checked by the website itself.
  assert.match(read("server/intake/hold-inquiry.ts"), /await adminAppCheck\.verifyToken\(input\.appCheckToken\)/);
});

test("a held inquiry reads as received on the client's form, and is held once", () => {
  const receipt = heldInquiryReceipt("held_abc123");
  assert.equal(receipt.leadId, "held_abc123");
  assert.deepEqual(receipt.missingInformation, []);
  // The form's success test is `"leadId" in payload` with response.ok (202).
  assert.match(read("components/crm/lead-intake-form.tsx"), /if \(!response\.ok \|\| !\("leadId" in payload\)\)/);
  const bytes = new TextEncoder().encode('{"tenantSlug":"gr-productions"}');
  assert.equal(heldInquiryId(bytes, "1.2.3.4"), heldInquiryId(bytes, "1.2.3.4"));
  assert.notEqual(heldInquiryId(bytes, "1.2.3.4"), heldInquiryId(bytes, "5.6.7.8"));
});

test("delivery goes through the live form's own checks, and says when it can't", () => {
  assert.deepEqual(pendingInquiryOutcome(201, { leadId: "lead_1" }), { kind: "delivered", leadId: "lead_1" });
  assert.equal(pendingInquiryOutcome(400, { error: "INVALID_INQUIRY" }).kind, "rejected");
  assert.equal(pendingInquiryOutcome(404, { error: "INQUIRY_FORM_UNAVAILABLE" }).kind, "rejected");
  assert.equal(pendingInquiryOutcome(429, { error: "RATE_LIMITED" }).kind, "retry");
  assert.equal(pendingInquiryOutcome(500, {}).kind, "retry");
  assert.ok(PENDING_INQUIRY_MAX_ATTEMPTS >= 12, "a two-hour outage is covered");
  const lead = read("functions/src/crm/public-lead.ts");
  assert.match(lead, /export async function handlePublicInquiry\(body: unknown, sender: InquirySender, response: InquiryReply\)/);
  assert.match(lead, /addressFingerprint\(sender\.address, `lead:\$\{tenantId\}`\)/);
  assert.match(read("functions/src/crm/pending-inquiries.ts"), /await handlePublicInquiry\(\s*held\.get\("body"\)/);
});

test("the held collection is server-only, and its scheduler survives the invoker reset", () => {
  assert.match(read("firestore.rules"), /match \/pendingInquiries\/\{inquiryId\} \{\s*allow read, write: if false;/);
  assert.match(read("scripts/configure-production-function-invokers.sh"), /\n  pendinginquirydelivery\n/);
  assert.match(read("functions/src/index.ts"), /export \{ pendingInquiryDelivery \} from "\.\/crm\/pending-inquiries\.js";/);
});
