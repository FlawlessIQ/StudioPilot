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
  // StudioCue's own contract step now comes first in the chain, so the
  // failed-send branch opens with ": contractFailed ? (".
  const start = workspace.indexOf("contractFailed ? (\n");
  assert.ok(start > 0, "the failed-send branch is still there");
  const failed = workspace.slice(start, start + 3000);
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

/**
 * The same promise sat in two places and only one was fixed first time — the
 * exact shape of `copy-outlives-the-change`: sweep by claim, not by directory.
 *
 * Allowed only where it is true: `project-booking-workspace.tsx` makes it
 * inside a `signingOffered` branch, where a provider really does reuse an
 * approved template.
 */
test("nothing claims StudioCue reuses an imported agreement by itself", () => {
  for (const path of [
    "features/today/setup-gaps.ts",
    "components/setup/setup-conversation.tsx",
  ]) {
    const text = readFileSync(`${process.cwd()}/${path}`, "utf8");
    // Comments explaining the old copy are fine; the claim is not.
    const claims = text
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
      .join("\n");
    assert.ok(
      !/reuses it for every client/i.test(claims),
      `${path} still promises StudioCue reuses the agreement`,
    );
    assert.ok(
      !/agreement is ready to send/i.test(claims),
      `${path} still implies StudioCue sends the agreement`,
    );
  }
});


/**
 * Where StudioCue does write contracts, the card may finally say so — and
 * only there. The promise withdrawn above is true for a studio with native
 * signing switched on, and false for everyone else.
 */
test("with StudioCue signing on, the card asks for the agreement and says what happens", () => {
  const native = setupGaps(
    { ...base, nativeSigning: true },
    { ...noSignals, projectsNeedingAgreement: ["Erin and Joe"] },
  ).find((gap) => gap.key === "agreement");
  assert.ok(native);
  assert.equal(native.href, "/studio/contracts/agreement");
  assert.match(native.detail, /writes their contract/);
  assert.match(native.detail, /sign in their portal/);
  assert.ok(native.blocking);
});

test("without it, nothing claims StudioCue writes the contract", () => {
  const idle = setupGaps({ ...base, nativeSigning: false }, noSignals).find(
    (gap) => gap.key === "agreement",
  );
  assert.ok(idle);
  assert.doesNotMatch(idle.detail, /writes (their|each|your)/i);
  assert.match(idle.detail, /doesn't write your contract/i);
});

test("the setup conversation's native promise is gated on the native link", () => {
  const conversation = readFileSync(
    `${process.cwd()}/components/setup/setup-conversation.tsx`,
    "utf8",
  );
  assert.match(conversation, /gap\?\.href === NATIVE_AGREEMENT_HREF/);
  // The default question copy still says the honest thing.
  assert.match(conversation, /StudioCue doesn't write your contract\./);
});
