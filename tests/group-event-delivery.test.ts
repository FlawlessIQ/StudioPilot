import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  deliveryUrlProblem,
  groupDeliveryProgress,
  groupReviewDueAt,
  matchDeliveryLines,
  nameKey,
  parseDeliveryLines,
  participantDeliveryState,
  participantsCloseout,
  participantsCloseoutLabel,
  releaseDecision,
  rosterDeliveryMove,
} from "../features/group-events/delivery.ts";
import { groupEventDay, groupEventShown, deliveryLine } from "../features/group-events/today-summary.ts";
import {
  GROUP_DELIVERY_EMAIL,
  GROUP_REVIEW_EMAIL,
  groupDeliveryJobId,
  groupReviewJobId,
  participantDeliveryPlan,
  participantReviewDecision,
  participantReviewPlan,
} from "../functions/src/group-events/participant-delivery-core.ts";
import { clientAutomationEmailTypes } from "../functions/src/imports/existing-booking.ts";
import { clientAutomationEmailTypes as appAutomationTypes } from "../features/imports/existing-booking.ts";
import { billingHoldApplies } from "../functions/src/saas/billing-hold.ts";
import { CLIENT_EMAIL_TYPES, renderEmailTemplate } from "../functions/src/communications/email-templates.ts";
import { EDITABLE_EMAILS, editableEmailsFor } from "../features/communications/email-catalog.ts";

/**
 * Group events Phase 5: each parent's own delivery, released by the studio,
 * and one review ask after it (features/group-events/delivery.ts,
 * functions/src/group-events/participant-delivery-core.ts).
 */

const read = (path: string) => readFileSync(path, "utf8");
const brand = { studioName: "GR Productions", productName: "StudioCue", accentColor: null, logoUrl: null, replyTo: null } as never;
const LINK = "https://gr.pixieset.com/ava-smith";
const place = (extra: Record<string, unknown> = {}) => ({
  id: "p1",
  tenantId: "t",
  status: "paid",
  amountCents: 4500,
  email: "dana@example.com",
  parentName: "Dana Smith",
  athleteName: "Ava Smith",
  delivery: null as Record<string, unknown> | null,
  ...extra,
});
const event = (extra: Record<string, unknown> = {}) => ({
  tenantId: "t",
  state: "POST_PRODUCTION",
  eventDate: "2026-10-04",
  groupEvent: { enabled: true },
  ...extra,
});
const tenant = { tenantId: "t", reviewLinks: { google: "https://g.page/r/gr-productions/review" } };

// ── The shared module ──

test("the functions copy of the delivery module matches the app's, below the marker", () => {
  const body = (file: string) => {
    const text = read(file);
    const marker = "// --- shared with functions/src/group-events/delivery.ts ---";
    assert.ok(text.includes(marker), `${file} has the marker`);
    return text.slice(text.indexOf(marker));
  };
  assert.equal(body("functions/src/group-events/delivery.ts"), body("features/group-events/delivery.ts"));
});

// ── Links ──

test("only a full https link can be attached", () => {
  assert.equal(deliveryUrlProblem(LINK), null);
  assert.equal(deliveryUrlProblem("http://gr.pixieset.com/ava"), "not_https");
  assert.equal(deliveryUrlProblem("javascript:alert(1)"), "not_https");
  assert.equal(deliveryUrlProblem("https://nohost"), "invalid");
  assert.equal(deliveryUrlProblem(""), "required");
  assert.equal(deliveryUrlProblem(`https://a.com/${"x".repeat(2100)}`), "too_long");
});

// ── Matching pasted lines by name ──

test("names match whatever the case, spacing, accents or quotes", () => {
  assert.equal(nameKey("  Ava   SMITH "), nameKey("ava smith"));
  assert.equal(nameKey("Zoë O’Neil"), nameKey("zoe o'neil"));
  assert.notEqual(nameKey("Ava Smith"), nameKey("Ava Smyth"));
});

test("a dash, a comma, a tab or the link first all read", () => {
  const lines = parseDeliveryLines(
    [
      "Ava Smith — https://gr.pixieset.com/ava",
      "Mia Jones, https://www.dropbox.com/s/mia",
      "Liam Brown\thttps://drive.google.com/drive/folders/liam",
      "https://gr.pixieset.com/noah - Noah Lee",
      "",
      "Emma Stone",
      "https://gr.pixieset.com/nobody",
      "Old Link http://insecure.example.com/x",
    ].join("\n"),
  );
  assert.deepEqual(
    lines.map((line) => ("problem" in line ? `${line.line}:${line.problem}` : `${line.line}:${line.name}|${line.url}`)),
    [
      "1:Ava Smith|https://gr.pixieset.com/ava",
      "2:Mia Jones|https://www.dropbox.com/s/mia",
      "3:Liam Brown|https://drive.google.com/drive/folders/liam",
      "4:Noah Lee|https://gr.pixieset.com/noah",
      "6:no_link",
      "7:no_name",
      "8:bad_link",
    ],
  );
});

test("matching never guesses: unmatched, shared names and repeats wait for the studio", () => {
  const roster = [
    { id: "a", athleteName: "Ava Smith", parentName: "Dana", status: "paid" },
    { id: "b1", athleteName: "Sam Lee", parentName: "Jo", status: "paid" },
    { id: "b2", athleteName: "sam  lee", parentName: "Kim", status: "unpaid" },
    { id: "c", athleteName: "Mia Jones", parentName: "Pat", status: "cancelled" },
  ];
  const match = matchDeliveryLines(
    parseDeliveryLines(
      ["AVA SMITH - https://x.com/1", "Sam Lee, https://x.com/2", "Mia Jones, https://x.com/3", "ava smith, https://x.com/4", "Nobody, https://x.com/5"].join(
        "\n",
      ),
    ),
    roster,
  );
  assert.deepEqual(match.matched, [{ participantId: "a", athleteName: "Ava Smith", url: "https://x.com/1", line: 1 }]);
  assert.deepEqual(
    match.ambiguous.map((item) => [item.line, item.candidates.map((candidate) => candidate.id)]),
    [[2, ["b1", "b2"]]],
  );
  // A cancelled place is never matched: it reads as nobody.
  assert.deepEqual(
    match.unmatched.map((item) => item.name),
    ["Mia Jones", "Nobody"],
  );
  assert.deepEqual(match.repeated.map((item) => [item.line, item.participantId]), [[4, "a"]]);
});

// ── Who gets their link ──

test("a delivery's state: none, ready, held unpaid, sent, changed, cancelled", () => {
  assert.equal(participantDeliveryState(place()), "none");
  assert.equal(participantDeliveryState(place({ delivery: { url: LINK } })), "ready");
  assert.equal(participantDeliveryState(place({ status: "unpaid", delivery: { url: LINK } })), "held_unpaid");
  assert.equal(participantDeliveryState(place({ status: "pay_on_day", delivery: { url: LINK } })), "held_unpaid");
  // Nothing owed is settled, even unpaid.
  assert.equal(participantDeliveryState(place({ status: "unpaid", amountCents: 0, delivery: { url: LINK } })), "ready");
  const sent = { url: LINK, releasedUrl: LINK, releasedAt: "2026-10-10T12:00:00Z" };
  assert.equal(participantDeliveryState(place({ delivery: sent })), "sent");
  assert.equal(participantDeliveryState(place({ delivery: { ...sent, url: "https://gr.pixieset.com/v2" } })), "changed");
  assert.equal(participantDeliveryState(place({ status: "cancelled", delivery: sent })), "cancelled");
});

test("release: held until paid unless the studio says, never twice, cancelled never", () => {
  assert.deepEqual(releaseDecision(place({ delivery: { url: LINK } })), { release: true, url: LINK, email: true, unpaid: false });
  assert.deepEqual(releaseDecision(place({ status: "unpaid", delivery: { url: LINK } })), { release: false, reason: "unpaid" });
  assert.deepEqual(releaseDecision(place({ status: "unpaid", delivery: { url: LINK } }), { allowUnpaid: true }), {
    release: true,
    url: LINK,
    email: true,
    unpaid: true,
  });
  assert.deepEqual(releaseDecision(place()), { release: false, reason: "no_link" });
  const sent = { url: LINK, releasedUrl: LINK, releasedAt: "2026-10-10T12:00:00Z" };
  assert.deepEqual(releaseDecision(place({ delivery: sent })), { release: false, reason: "already_sent" });
  assert.deepEqual(releaseDecision(place({ status: "cancelled", delivery: { url: LINK } }), { allowUnpaid: true }), {
    release: false,
    reason: "cancelled",
  });
  // A replaced link goes again, to someone already given one, paid or not.
  const replaced = { ...sent, url: "https://gr.pixieset.com/v2" };
  assert.equal(releaseDecision(place({ status: "unpaid", delivery: replaced })).release, true);
  // No email: released (their order page shows it), nothing mailed.
  assert.deepEqual(releaseDecision(place({ email: null, delivery: { url: LINK } })), { release: true, url: LINK, email: false, unpaid: false });
});

test("one email per place per link: the same link is the same email, a new link a new one", () => {
  assert.equal(groupDeliveryJobId("p1", LINK), groupDeliveryJobId("p1", ` ${LINK} `));
  assert.notEqual(groupDeliveryJobId("p1", LINK), groupDeliveryJobId("p1", "https://gr.pixieset.com/v2"));
  assert.notEqual(groupDeliveryJobId("p1", LINK), groupDeliveryJobId("p2", LINK));
  assert.equal(groupReviewJobId("p1"), "group_review_p1");
});

test("progress counts what's delivered, ready, held and missing", () => {
  const sent = { url: LINK, releasedUrl: LINK, releasedAt: "2026-10-10T12:00:00Z" };
  const progress = groupDeliveryProgress([
    place({ delivery: sent }),
    place({ delivery: { ...sent, url: "https://x.com/new" } }),
    place({ delivery: { url: LINK } }),
    place({ status: "unpaid", delivery: { url: LINK } }),
    place(),
    place({ status: "cancelled", delivery: sent }),
  ]);
  assert.deepEqual(progress, { total: 5, delivered: 2, ready: 2, heldUnpaid: 1, missing: 1 });
});

// ── Close-out ──

test("a group event closes when everyone not cancelled is paid and delivered", () => {
  const sent = { url: LINK, releasedUrl: LINK, releasedAt: "2026-10-10T12:00:00Z" };
  assert.equal(participantsCloseout(false, [place()]).applies, false, "no roster: the ordinary checks");
  assert.equal(participantsCloseout(true, []).applies, false, "nobody on it: the ordinary checks");
  const open = participantsCloseout(true, [place({ delivery: sent }), place({ status: "unpaid", delivery: sent }), place()]);
  assert.deepEqual(open, { applies: true, complete: false, total: 3, settled: 2, delivered: 2 });
  assert.equal(participantsCloseoutLabel(open), "Everyone on the roster paid and delivered (2 of 3 paid, 2 of 3 delivered)");
  const done = participantsCloseout(true, [place({ delivery: sent }), place({ status: "cancelled" }), place({ status: "unpaid", amountCents: 0, delivery: sent })]);
  assert.equal(done.complete, true);
  assert.equal(participantsCloseoutLabel(done), "Everyone on the roster paid and delivered");
});

test("a roster job moves to DELIVERED on its own once everyone not cancelled has their link", () => {
  const sent = { url: LINK, releasedUrl: LINK, releasedAt: "2026-10-10T12:00:00Z" };
  const everyone = [place({ delivery: sent }), place({ status: "unpaid", delivery: sent }), place({ status: "cancelled" })];
  assert.equal(rosterDeliveryMove("POST_PRODUCTION", true, everyone), true, "unpaid but sent still counts as delivered");
  assert.equal(rosterDeliveryMove("EVENT_COMPLETE", true, everyone), true);
  assert.equal(rosterDeliveryMove("POST_PRODUCTION", true, [...everyone, place()]), false, "someone still waiting");
  assert.equal(rosterDeliveryMove("POST_PRODUCTION", false, everyone), false, "no roster: the wedding release decides");
  assert.equal(rosterDeliveryMove("POST_PRODUCTION", true, [place({ status: "cancelled" })]), false, "nobody on it");
  for (const state of ["DELIVERED", "REVIEW_REQUESTED", "CLOSED", "CANCELLED", "POSTPONED"]) {
    assert.equal(rosterDeliveryMove(state, true, everyone, "2026-10-01", "2026-10-12"), false, state);
  }
  // A studio that never marked the day done: only once the day has passed.
  assert.equal(rosterDeliveryMove("BOOKED", true, everyone, "2026-10-10", "2026-10-12"), true);
  assert.equal(rosterDeliveryMove("READY", true, everyone, "2026-10-12", "2026-10-12"), true, "on the day");
  assert.equal(rosterDeliveryMove("READY", true, everyone, "2026-10-20", "2026-10-12"), false, "before the day");
  assert.equal(rosterDeliveryMove("PLANNING", true, everyone, null, "2026-10-12"), false, "no date");
});

test("the release command reads the whole roster before writing, and moves the job only by the rule", () => {
  const source = read("functions/src/crm/commands.ts");
  const release = source.slice(source.indexOf('command.type === "releaseParticipantDeliveries"'));
  const firstWrite = release.indexOf("transaction.update(");
  assert.ok(release.indexOf("const roster = chosen") < firstWrite, "every read before the first write");
  assert.match(release, /const becomesDelivered = rosterDeliveryMove\(/);
  assert.match(release, /if \(becomesDelivered\) \{\s*transaction\.update\(project\.ref, \{\s*state: "DELIVERED"/);
});

test("prepareCloseout adds the roster rule only for a roster job, and nobody may vouch for it", () => {
  const source = read("functions/src/post-event/commands.ts");
  assert.match(source, /participantsCloseout\(\s*project\.get\("groupEvent\.enabled"\) === true/);
  assert.match(source, /if \(roster\.applies\)\s*requirements\.push\(\{\s*key: "participants"/);
  const attestation = read("functions/src/post-event/closeout-attestation.ts");
  assert.ok(!/"participants"/.test(attestation), "money and delivery to each parent are evidence only");
});

// ── Review asks ──

test("one review ask per parent, some days after their delivery", () => {
  assert.equal(groupReviewDueAt("2026-10-10T12:00:00.000Z"), "2026-10-13T12:00:00.000Z");
  const delivered = place({
    delivery: { url: LINK, releasedUrl: LINK, releasedAt: "2026-10-10T12:00:00Z" },
    reviewAsk: { state: "scheduled", dueAt: "2026-10-13T12:00:00.000Z" },
  });
  const now = "2026-10-13T13:00:00.000Z";
  assert.deepEqual(participantReviewDecision({ project: event(), participant: delivered, tenant, now }), {
    send: true,
    destinationUrl: "https://g.page/r/gr-productions/review",
    destinationLabel: "google",
  });
  const held = (project: Record<string, unknown> | null, participant: Record<string, unknown> | null, studio: Record<string, unknown> | null = tenant) => {
    const decision = participantReviewDecision({ project, participant, tenant: studio, now });
    return decision.send ? "send" : decision.reason;
  };
  assert.equal(held(event(), { ...delivered, reviewAsk: { state: "scheduled", dueAt: "2026-10-14T00:00:00.000Z" } }), "not_yet");
  assert.equal(held(event(), delivered, { reviewLinks: {} }), "no_review_link");
  assert.equal(held(event({ reviewRequestsSkippedAt: "2026-10-11T00:00:00Z" }), delivered), "skipped");
  assert.equal(held(event({ archivedAt: "2026-10-12T00:00:00Z" }), delivered), "put_away");
  assert.equal(held(event({ clientAutomationsPausedAt: "2026-10-01T00:00:00Z" }), delivered), "automations_paused");
  assert.equal(held(null, delivered), "job_missing");
  assert.equal(held(event(), { ...delivered, status: "cancelled" }), "participant_cancelled");
  assert.equal(held(event(), { ...delivered, delivery: null }), "not_delivered");
  assert.equal(held(event(), { ...delivered, email: null }), "no_email");
  assert.equal(held(event(), { ...delivered, reviewAsk: { state: "queued" } }), "not_scheduled");
});

test("the review ask and the delivery are read again as they send", () => {
  const sent = { url: LINK, releasedUrl: LINK, releasedAt: "2026-10-10T12:00:00Z" };
  const deliveryJob = { galleryUrl: LINK };
  assert.deepEqual(participantDeliveryPlan({ job: deliveryJob, project: event(), participant: place({ delivery: sent }) }), {
    values: { galleryUrl: LINK, athleteName: "Ava Smith", deliveredNoun: "photos" },
  });
  const hold = (plan: ReturnType<typeof participantDeliveryPlan>) => ("hold" in plan ? plan.hold : "send");
  assert.equal(hold(participantDeliveryPlan({ job: deliveryJob, project: event(), participant: place({ status: "cancelled", delivery: sent }) })), "participant_cancelled");
  assert.equal(
    hold(participantDeliveryPlan({ job: deliveryJob, project: event(), participant: place({ delivery: { ...sent, url: "https://x.com/new", releasedUrl: "https://x.com/new" } }) })),
    "link_replaced",
  );
  assert.equal(hold(participantDeliveryPlan({ job: deliveryJob, project: event({ state: "CANCELLED" }), participant: place({ delivery: sent }) })), "cancelled");
  // The studio pressed release on a quiet (imported) job itself: it goes.
  assert.equal(hold(participantDeliveryPlan({ job: deliveryJob, project: event({ clientAutomationsPausedAt: "x" }), participant: place({ delivery: sent }) })), "send");
  assert.equal(hold(participantDeliveryPlan({ job: deliveryJob, project: null, participant: place({ delivery: sent }) })), "job_missing");

  const reviewJob = { destinationUrl: "https://g.page/r/gr/review" };
  const delivered = place({ delivery: sent });
  assert.ok("values" in participantReviewPlan({ job: reviewJob, project: event(), participant: delivered }));
  const reviewHold = (project: Record<string, unknown> | null, participant: Record<string, unknown> | null) => {
    const plan = participantReviewPlan({ job: reviewJob, project, participant });
    return "hold" in plan ? plan.hold : "send";
  };
  assert.equal(reviewHold(event({ reviewRequestsSkippedAt: "x" }), delivered), "review_requests_skipped");
  assert.equal(reviewHold(event({ clientAutomationsPausedAt: "x" }), delivered), "automations_paused");
  assert.equal(reviewHold(event(), { ...delivered, status: "cancelled" }), "participant_cancelled");
  assert.equal(reviewHold(null, delivered), "job_missing");
});

test("the review ask is a client automation (held for a quiet job and a lapsed studio); the delivery is the studio's act", () => {
  assert.ok(clientAutomationEmailTypes.includes(GROUP_REVIEW_EMAIL));
  assert.ok(appAutomationTypes.includes(GROUP_REVIEW_EMAIL), "the app's mirror says so too");
  assert.ok(!clientAutomationEmailTypes.includes(GROUP_DELIVERY_EMAIL));
  assert.ok(billingHoldApplies("emailJobs", GROUP_DELIVERY_EMAIL), "held while the studio's billing has lapsed");
  assert.ok(billingHoldApplies("emailJobs", GROUP_REVIEW_EMAIL));
});

test("the sweep runs inside the hourly review scheduler: no new function", () => {
  assert.match(read("functions/src/post-event/jobs.ts"), /sweepParticipantReviewAsks\(db, now\)/);
  assert.ok(!/sweepParticipantReviewAsks/.test(read("functions/src/index.ts")));
  const sweep = read("functions/src/group-events/participant-delivery.ts");
  assert.match(sweep, /where\("reviewAskDueAt", "<=", now\)/);
  assert.match(sweep, /soleRecipient: true,\s*audience: "parent"/);
});

// ── Emails ──

test("the delivery email leads with their link and links their order page; one recipient", () => {
  assert.ok(CLIENT_EMAIL_TYPES.has(GROUP_DELIVERY_EMAIL) && CLIENT_EMAIL_TYPES.has(GROUP_REVIEW_EMAIL));
  const email = renderEmailTemplate({
    key: GROUP_DELIVERY_EMAIL,
    brand,
    recipientName: "Dana Smith",
    projectName: "Fall Cheer Classic",
    values: { galleryUrl: LINK, deliveredNoun: "photos", athleteName: "Ava Smith", actionUrl: "https://studio-cue.com/e/order/tok" },
  });
  assert.match(email.subject, /Ava Smith's photos from Fall Cheer Classic are ready/);
  assert.ok(email.text.indexOf(LINK) < email.text.indexOf("https://studio-cue.com/e/order/tok"), "their link first, then their order");
  const ask = renderEmailTemplate({
    key: GROUP_REVIEW_EMAIL,
    brand,
    recipientName: "Dana Smith",
    projectName: "Fall Cheer Classic",
    values: {
      destinationUrl: "https://g.page/r/gr/review",
      deliveredNoun: "photos",
      athleteName: "Ava Smith",
      eventKind: "sports",
      actionUrl: "https://studio-cue.com/e/order/tok",
    },
  });
  assert.match(ask.text, /helps other parents find us/);
  assert.match(ask.text, /https:\/\/g\.page\/r\/gr\/review/);
  assert.match(ask.text, /studio-cue\.com\/e\/order\/tok/);
  const release = read("functions/src/crm/commands.ts");
  assert.match(release, /type: GROUP_DELIVERY_EMAIL,[\s\S]{0,500}soleRecipient: true,\s*audience: "parent"/);
});

test("both emails are listed for the studio to edit, and only for a trade that delivers", () => {
  for (const key of [GROUP_DELIVERY_EMAIL, GROUP_REVIEW_EMAIL]) {
    assert.ok(EDITABLE_EMAILS.some((email) => email.key === key), key);
    assert.ok(!editableEmailsFor("dj").some((email) => email.key === key), `${key} hidden for a DJ`);
  }
});

// ── Today ──

test("Today says how many have their link, and keeps a past event while links wait to be sent", () => {
  const sent = { url: LINK, releasedUrl: LINK, releasedAt: "2026-10-10T12:00:00Z" };
  const roster = [
    place({ id: "a", delivery: sent }),
    place({ id: "b", delivery: { url: LINK } }),
    place({ id: "c", status: "unpaid", delivery: { url: LINK } }),
    place({ id: "d" }),
  ] as never[];
  const day = groupEventDay(roster, { enabled: true }, { now: "2026-10-12T12:00:00Z", isToday: () => false });
  assert.equal(deliveryLine(day), "1 of 4 delivered · 1 ready to send · 1 held until paid");
  const past = { id: "x", name: "Fall Cheer", eventDate: "2026-10-04", dayOffset: -8, groupEvent: { enabled: true } };
  const paidUp = groupEventDay([place({ id: "b", delivery: { url: LINK } })] as never[], { enabled: true }, { now: "2026-10-12T12:00:00Z", isToday: () => false });
  assert.equal(groupEventShown(past, paidUp), true, "a link waiting to be sent keeps it on Today");
  const nothing = groupEventDay([place({ id: "a", delivery: sent })] as never[], { enabled: true }, { now: "2026-10-12T12:00:00Z", isToday: () => false });
  assert.equal(groupEventShown(past, nothing), false);
  assert.equal(deliveryLine(groupEventDay([place()] as never[], { enabled: true }, { now: "2026-10-12T12:00:00Z", isToday: () => false })), null);
});

// ── Trust boundary ──

test("participants stay server-written, and the delivery commands are the studio's, not field crew's", () => {
  const rules = read("firestore.rules");
  assert.match(rules, /match \/eventParticipants\/\{participantId\} \{[\s\S]*?allow write: if false;/);
  const commands = read("functions/src/crm/commands.ts");
  assert.match(commands, /const fieldCrewCommands: readonly string\[\] = \["recordParticipantPayment"\];/);
  assert.match(commands, /DELIVERY_UNPAID_ONE_AT_A_TIME/);
});
