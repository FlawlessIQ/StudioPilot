import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { setupGaps } from "@/features/today/setup-gaps";

/**
 * The card said StudioCue would reuse an imported agreement "for every client".
 * It does not. The import writes an `agreementTemplates` document that nothing
 * reads, and `hasAgreementTemplate` resolves to a signing provider's template
 * id or to a provider being connected at all.
 *
 * So the reference studio imported his agreement, waited, and told us "never
 * got a contract to sign, so couldn't complete the run through" — then asked
 * "is it making the contract for me?". No. It never was.
 */
const base = {
  hasActivePackage: true,
  hasAgreementTemplate: false,
  hasQuestionnaireTemplate: true,
  hasConsultationAvailability: true,
};
const noSignals = {
  projectsNeedingPackage: [],
  projectsNeedingAgreement: [],
  projectsNeedingForm: [],
  openInquiries: 0,
};
const gapFor = (signals: Partial<typeof noSignals> = {}) =>
  setupGaps(base, { ...noSignals, ...signals }).find((gap) => gap.key === "agreement");

test("the card no longer claims StudioCue reuses an imported agreement", () => {
  const idle = gapFor();
  assert.ok(idle);
  assert.ok(!/reuses it for every client/i.test(idle.detail));
  assert.ok(!/^Import your agreement$/.test(idle.title));
  // It says the one thing that is true and was never said.
  assert.match(idle.detail, /doesn't write your contract/i);
});

test("both working paths are named, because both work", () => {
  const idle = gapFor();
  assert.ok(idle);
  assert.match(idle.detail, /record the signature/i);
  assert.match(idle.detail, /signing app/i);
});

/**
 * The old link went to the import flow, which is the one place that could not
 * help — it is where he went, and why he waited.
 */
test("a waiting job links to where the control actually is", () => {
  const blocked = gapFor({ projectsNeedingAgreement: ["Gabe and Dionne"] });
  assert.ok(blocked);
  assert.ok(!blocked.href.includes("/studio/import"));
  assert.match(blocked.actionLabel, /Record a signature/);
  assert.match(blocked.detail, /Gabe and Dionne/);
});

const workspace = readFileSync(
  `${process.cwd()}/components/booking/project-booking-workspace.tsx`,
  "utf8",
);

/**
 * With no signing app connected the send cannot succeed, so a retry is a loop
 * that cannot end. He sat on exactly this screen.
 */
test("the failed-send screen offers recording, not an impossible retry", () => {
  const failed = workspace.slice(
    workspace.indexOf("{contractFailed ? ("),
    workspace.indexOf("{contractFailed ? (") + 3000,
  );
  assert.match(failed, /\{signingOffered \? \(\s*\n?\s*<button/);
  assert.match(failed, /No signing app is connected/);
  assert.match(failed, /primary=\{!signingOffered\}/);
});

/** Both places that offer it treat it as the workflow when it is the only one. */
test("recording is primary wherever no signing app is offered", () => {
  assert.equal(
    (workspace.match(/primary=\{!signingOffered\}/g) ?? []).length,
    2,
    "both RecordSignedAgreement sites must promote recording when nothing else works",
  );
});
