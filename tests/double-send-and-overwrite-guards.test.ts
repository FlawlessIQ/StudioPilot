import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Found while planning the 2026-09-28 build queue, fixed before any of it
 * (execution-plan-2026-09-28.md, Phase 0). Each one reached a couple or lost
 * a record, and none was covered by a test.
 */

const source = (path: string) =>
  readFileSync(`${process.cwd()}/${path}`, "utf8");

/**
 * Release stayed enabled while its request ran and the server read the
 * project's state outside the write, so a double-click sent the couple two
 * deliveries, two emails and four review requests.
 */
test("a delivery is released once per press", () => {
  const form = source("components/post-event/delivery-form.tsx");
  assert.match(form, /if \(busy\) return;/);
  assert.match(form, /disabled=\{!interactive \|\| gateBlocked \|\| busy\}/);
  assert.match(form, /finally \{\s*setBusy\(false\);/);
});

test("a second concurrent release fails whole on the server", () => {
  // Release is repeatable now (H4), so the project's state no longer stops a
  // second one. The same link twice does: the transaction reads the job's
  // deliveries, so a racing release retries against the first and is refused.
  const release = source("functions/src/post-event/release.ts");
  assert.match(release, /if \(items\.some\(\(item\) => alreadySent\.has\(item\.galleryUrl\)\)\) throw new Error\("DELIVERY_ALREADY_RECORDED"\)/);
  assert.match(release, /return db\.runTransaction\(async \(transaction\) => \{/);
  assert.match(
    source("lib/ai/friendly-error.ts"),
    /DELIVERY_ALREADY_RECORDED:/,
  );
});

/**
 * Recording the delivery queues the couple's email on the server. The form
 * then asked Cue for a "delivery_note" draft too, and approving it sent the
 * gallery a second time.
 */
test("recording a delivery does not also draft a second delivery email", () => {
  const form = source("components/post-event/delivery-form.tsx");
  assert.doesNotMatch(form, /requestMessageDraft/);
  assert.match(
    source("functions/src/post-event/release.ts"),
    /emailJobs\/delivery_\$\{records\[0\]!\.id\}/,
  );
});

/**
 * The portal API returned delivery notes the portal never showed, from a field
 * that never said who could read it. Studios wrote internal notes there.
 */
test("internal delivery notes do not reach the couple", () => {
  const portal = source("app/api/client/portal/route.ts");
  const fields = portal.slice(
    portal.indexOf("deliveryRecords: ["),
    portal.indexOf("albumWorkflows: ["),
  );
  assert.doesNotMatch(fields, /^\s*"notes",/m);
  assert.match(
    source("components/post-event/delivery-form.tsx"),
    /The couple never sees these\./,
  );
});

test("answers find the gallery by the statuses a delivery really has", () => {
  const facts = source("functions/src/communications/answer-facts.ts");
  assert.doesNotMatch(facts, /=== "delivered"/);
  assert.match(
    facts,
    /RELEASED_DELIVERY_STATUSES = new Set\(\["sent", "viewed", "downloaded"\]\)/,
  );
});

test("the job page reads deliveries from the collection they are written to", () => {
  const page = source("components/projects/live-project-detail.tsx");
  assert.match(page, /collectionName: "deliveryRecords"/);
  assert.doesNotMatch(page, /collectionName: "deliveries"/);
});

/**
 * An agent resending an old PDF after the studio had approved the certificate
 * replaced the approved file and put the request back to "received".
 */
test("a certificate is only taken while one is being asked for", () => {
  const inbound = source("functions/src/planning/inbound.ts");
  const accepting = inbound.slice(
    inbound.indexOf("export const ACCEPTING_STATUSES"),
    inbound.indexOf("]);", inbound.indexOf("export const ACCEPTING_STATUSES")),
  );
  for (const open of ["requested", "awaiting_response", "correction_required", "failed"]) {
    assert.match(accepting, new RegExp(`"${open}"`));
  }
  for (const closed of ["approved", "sent_to_venue", "venue_acknowledged", "under_review"]) {
    assert.doesNotMatch(accepting, new RegExp(`"${closed}"`));
  }
  // Checked before the file is stored, and the request must be unchanged
  // when the write lands.
  assert.ok(
    inbound.indexOf("ACCEPTING_STATUSES.has(status)") <
      inbound.indexOf("await file.save("),
  );
  assert.match(inbound, /\{ lastUpdateTime: coi\.updateTime \}/);
});

/**
 * The correction email had no reply-to, so the agent's fixed certificate went
 * to the studio's inbox and never reached the request.
 */
test("a correction request routes the reply back to the certificate request", () => {
  const commands = source("functions/src/planning/commands.ts");
  const block = commands.slice(commands.indexOf("emailJobs/coi_correction_"));
  const before = commands.slice(0, commands.indexOf("emailJobs/coi_correction_"));
  assert.match(before.slice(-800), /emailJobs\/coi_request_\$\{parsed\.input\.requestId\}/);
  assert.match(block.slice(0, 800), /replyAddress/);
});

/**
 * Typed venue text was split on commas on every keystroke and written over the
 * City the couple had already entered.
 */
test("only a chosen venue fills City, and only an empty one", () => {
  const form = source("components/crm/lead-intake-form.tsx");
  const apply = form.slice(
    form.indexOf("function applyVenue("),
    form.indexOf("}", form.indexOf("placeCity(place)")),
  );
  assert.match(apply, /if \(!place\?\.verified \|\| \(getValues\("city"\) \?\? ""\)\.trim\(\)\) return;/);
  assert.match(apply, /shouldValidate: Boolean\(place\?\.verified\)/);
});

/**
 * Walked on production, 2026-09-28: an imported wedding whose date had passed
 * could not be marked shot while it was quiet. The quiet card replaced the
 * next move entirely, including "Yes, we shot it", which contacts no one.
 */
test("a quiet imported job can still be marked shot", () => {
  const thread = source("components/projects/project-thread.tsx");
  const quiet = thread.slice(
    thread.indexOf("Nothing is being sent to this couple."),
    thread.indexOf("if (interruption) {"),
  );
  assert.match(quiet, /current\?\.advance\?\.targetState === "EVENT_COMPLETE"/);
  assert.match(quiet, /<MarkDoneButton/);
});

/** "SHOT" is a label, not a state, so the branch built for shot jobs never ran. */
test("the checklist recognises a shot job by its real state", () => {
  const checklist = source("components/post-event/post-production-checklist.tsx");
  assert.match(checklist, /\["EVENT_COMPLETE", "POST_PRODUCTION"\]\.includes\(state\)/);
  assert.doesNotMatch(checklist, /\["SHOT"/);
});

test("the delivery step no longer promises a drafted email", () => {
  const steps = source("features/journey/steps.ts");
  assert.doesNotMatch(steps, /the email drafts itself/);
  assert.match(steps, /Confirm editing has started, then record the gallery/);
});
