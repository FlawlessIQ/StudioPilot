import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  allowedProjectTransitions,
  evidenceControlledProjectTransitions,
  transitionRoute,
} from "@/features/projects/state-machine";
import type { ProjectState } from "@/features/projects/schema";
import {
  backwardMovesFor,
  cancelConsequences,
  uncancelRefusal,
  UNCANCEL_WINDOW_DAYS,
} from "@/features/projects/going-back";
import { INTERRUPTION_COPY } from "@/features/projects/interruptions";
import { friendlyError } from "@/lib/ai/friendly-error";
import { planClientProposalDecision } from "@/server/client/proposal-decision";
import {
  evidenceControlledTransitions as functionsEvidence,
  transitionRoute as functionsRoute,
  transitions as functionsTransitions,
  uncancelRefusal as functionsUncancelRefusal,
  UNCANCEL_WINDOW_DAYS as FUNCTIONS_UNCANCEL_WINDOW_DAYS,
} from "../functions/src/crm/transitions.ts";
import {
  agreementOutRefusal,
  planStoppedAgreements,
  writeStoppedAgreements,
} from "../functions/src/booking/stopped-agreements.ts";
import { renderEmailTemplate } from "../functions/src/communications/email-templates.ts";

/**
 * Wave 3 of the change-your-mind audit (2026-09-30): a job can go back.
 * Behaviour where the rule is pure; source reads only where the fix is wiring
 * inside a Cloud Function.
 */

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
const states = Object.keys(allowedProjectTransitions) as ProjectState[];
const brand = {
  studioName: "Alder & Muse Photography",
  productName: "StudioCue",
  accentColor: "#35664a",
  logoUrl: null,
  contactEmail: null,
};

// ── The two state machines are one ──────────────────────────────────────────

test("the functions state machine is the features one, move by move", () => {
  assert.deepEqual(Object.keys(functionsTransitions).sort(), [...states].sort());
  for (const from of states) {
    assert.deepEqual(
      [...functionsTransitions[from]].sort(),
      [...allowedProjectTransitions[from]].sort(),
      `${from} drifted between features/ and functions/`,
    );
    for (const to of states)
      assert.equal(functionsRoute(from, to), transitionRoute(from, to), `${from}→${to} routes differently`);
  }
  assert.deepEqual(
    [...functionsEvidence].sort(),
    evidenceControlledProjectTransitions.map((move) => `${move.from}:${move.to}`).sort(),
  );
});

test("undoing a cancel answers the same on both sides", () => {
  assert.equal(FUNCTIONS_UNCANCEL_WINDOW_DAYS, UNCANCEL_WINDOW_DAYS);
  const now = "2026-10-10T12:00:00.000Z";
  const cases = [
    { state: "CANCELLED", cancelledFromState: "BOOKED", cancelledAt: "2026-10-01T12:00:00.000Z" },
    { state: "CANCELLED", cancelledFromState: "PROPOSAL", cancelledAt: "2026-08-01T12:00:00.000Z" },
    { state: "CANCELLED", cancelledAt: "2026-10-01T12:00:00.000Z" },
    { state: "CANCELLED", cancelledFromState: "ARCHIVED", cancelledAt: "2026-10-01T12:00:00.000Z" },
    { state: "CANCELLED", cancelledFromState: "READY", interruptionAt: "2026-10-05T12:00:00.000Z" },
    { state: "BOOKED", cancelledFromState: "BOOKED", cancelledAt: "2026-10-01T12:00:00.000Z" },
  ];
  for (const project of cases)
    assert.equal(functionsUncancelRefusal(project, now), uncancelRefusal(project, now), JSON.stringify(project));
});

// ── 1. Cancelling ──────────────────────────────────────────────────────────

test("a cancel goes back only where it came from, by the owner, within the window", () => {
  const now = "2026-10-10T12:00:00.000Z";
  assert.equal(uncancelRefusal({ state: "CANCELLED", cancelledFromState: "PLANNING", cancelledAt: "2026-10-01T00:00:00Z" }, now), null);
  assert.equal(
    uncancelRefusal({ state: "CANCELLED", cancelledFromState: "PLANNING", cancelledAt: "2026-09-01T00:00:00Z" }, now),
    "UNCANCEL_WINDOW_PASSED",
  );
  // Cancelled before the origin was recorded: refused, never guessed.
  assert.equal(uncancelRefusal({ state: "CANCELLED", cancelledAt: "2026-10-01T00:00:00Z" }, now), "UNCANCEL_ORIGIN_UNKNOWN");
  assert.equal(uncancelRefusal({ state: "BOOKED" }, now), "NOT_CANCELLED");

  const moves = backwardMovesFor(
    { id: "p", state: "CANCELLED", cancelledFromState: "PLANNING", cancelledAt: "2026-10-01T00:00:00Z" },
    { agreementOut: false, now },
  );
  assert.deepEqual(moves.map((move) => [move.route, move.target, move.ownerOnly]), [["uncancelProject", "PLANNING", true]]);
  // Nothing comes back on its own, and the move says so.
  assert.match(moves[0]!.detail, /stay released and voided/);
});

test("the cancel confirm lists what happens, and no longer reads as reversible", () => {
  const lines = cancelConsequences({
    acceptedCrew: 2,
    pendingOffers: 1,
    standingInvoices: 1,
    unsignedAgreementOut: true,
    outsideAgreementOut: false,
    onCalendar: true,
  }).join(" ");
  for (const claim of [/emailed straight away/, /withdrawn quietly/, /Billing stops/, /agreement .* withdrawn/, /Google Calendar/, /stops emailing the couple/, /30 days/])
    assert.match(lines, claim);
  assert.doesNotMatch(INTERRUPTION_COPY.CANCELLED.detail, /Nothing is deleted/);
  const page = read("components/projects/live-project-detail.tsx");
  assert.match(page, /"Keep the job"/);
  assert.match(page, /cancelConsequenceLines/);
  // "Tell the couple" is off unless ticked.
  assert.match(page, /const \[tellCouple, setTellCouple\] = useState\(false\)/);
});

test("a cancel withdraws an unsigned StudioCue agreement and tasks one out elsewhere", () => {
  const plan = planStoppedAgreements([
    { id: "sc-sent", status: "sent", provider: "studiocue" },
    { id: "sc-signed", status: "completed", provider: "studiocue" },
    { id: "sc-void", status: "voided", provider: "studiocue" },
    { id: "ds", status: "delivered", provider: "docusign" },
  ]);
  assert.deepEqual(plan, { voidIds: ["sc-sent"], outsideIds: ["ds"] });

  const writes: Array<[string, string, Record<string, unknown>]> = [];
  const doc = (id: string, data: Record<string, unknown>) => ({
    id,
    ref: { path: `contracts/${id}` },
    get: (field: string) => data[field],
  });
  const transaction = {
    update: (ref: { path: string }, data: Record<string, unknown>) => writes.push(["update", ref.path, data]),
    create: (ref: { path: string }, data: Record<string, unknown>) => writes.push(["create", ref.path, data]),
    set: (ref: { path: string }, data: Record<string, unknown>) => writes.push(["set", ref.path, data]),
  };
  const db = { doc: (path: string) => ({ path }) };
  const result = writeStoppedAgreements(db as never, transaction as never, {
    contracts: [
      doc("sc-sent", { status: "sent", provider: "studiocue" }),
      doc("sc-signed", { status: "completed", provider: "studiocue" }),
      doc("ds", { status: "delivered", provider: "docusign" }),
    ] as never,
    tenantId: "t",
    projectId: "p",
    now: "2026-10-01T00:00:00.000Z",
    actor: "u",
    correlationId: "c",
  });
  assert.deepEqual(result, { voidedContractIds: ["sc-sent"], cancelTaskIds: ["agreement_cancel_ds"] });
  assert.ok(writes.some(([kind, path, data]) => kind === "update" && path === "contracts/sc-sent" && data.status === "voided"));
  assert.ok(!writes.some(([, path]) => path === "contracts/sc-signed"), "a signed agreement is never touched");
  // No "a new agreement is on its way" email to a couple whose wedding is off.
  assert.ok(!writes.some(([, path]) => path.startsWith("emailJobs/")));
});

test("the cancel command records where it came from and does the rest in one transaction", () => {
  const crm = read("functions/src/crm/commands.ts");
  const branch = crm.slice(crm.indexOf('command.type === "transitionProject"'), crm.indexOf('command.type === "uncancelProject"'));
  assert.match(branch, /cancelledFromState: project\.state/);
  assert.match(branch, /writeStoppedAgreements\(/);
  assert.match(branch, /cancelled: true/, "accepted crew get the calendar file that removes the day");
  assert.match(branch, /type: "remove_booking_calendar_events"/);
  assert.match(branch, /type: "project_cancelled"/);
  assert.match(branch, /command\.input\.notifyClient/);
  const uncancel = crm.slice(crm.indexOf('command.type === "uncancelProject"'), crm.indexOf('command.type === "reopenJob"'));
  assert.match(uncancel, /membershipData\.role !== "studio_owner"/);
  assert.match(uncancel, /uncancelRefusal\(/);
  assert.match(uncancel, /action: "project\.uncancelled"/);
  // The provider worker knows the job, and leaves a wedding that came back alone.
  const runtime = read("functions/src/operations/provider-runtime.ts");
  assert.match(read("functions/src/operations/jobs.ts"), /type === "remove_booking_calendar_events"/);
  assert.match(runtime, /no_longer_cancelled/);
});

test("the couple's cancellation email is the studio's words, or a plain default", () => {
  const custom = renderEmailTemplate({
    key: "project_cancelled",
    brand,
    recipientName: "Jordan Rivera",
    projectName: "Rivera wedding",
    values: { customBody: "We're so sorry to hear the news. Your retainer will be refunded this week." },
  });
  assert.match(custom.subject, /cancelled/);
  assert.match(custom.text, /retainer will be refunded/);
  const plain = renderEmailTemplate({ key: "project_cancelled", brand, recipientName: "Jordan", projectName: "Rivera wedding", values: {} });
  assert.match(plain.text, /won't send you any more reminders or invoices/);
  assert.doesNotMatch(plain.text, /refund/, "the default never promises money back");
});

// ── 2. Reopening after the event ───────────────────────────────────────────

test("a delivered or closed job reopens, owner only, with a reason", () => {
  const now = "2026-10-10T12:00:00.000Z";
  for (const [state, target] of [
    ["DELIVERED", "POST_PRODUCTION"],
    ["REVIEW_REQUESTED", "POST_PRODUCTION"],
    ["CLOSED", "DELIVERED"],
  ] as const) {
    assert.equal(transitionRoute(state, target), "reopenJob");
    const [move] = backwardMovesFor({ id: "p", state }, { agreementOut: false, now });
    assert.equal(move?.target, target);
    assert.equal(move?.ownerOnly, true);
    assert.equal(move?.needsReason, true);
  }
  // Still forward-only in between.
  for (const state of ["EVENT_COMPLETE", "POST_PRODUCTION"] as const)
    assert.deepEqual(backwardMovesFor({ id: "p", state }, { agreementOut: false, now }), []);
});

test("reopening pauses the asks, and delivering again resumes them", () => {
  const crm = read("functions/src/crm/commands.ts");
  const branch = crm.slice(crm.indexOf('command.type === "reopenJob"'), crm.indexOf('command.type === "saveAddOn"'));
  assert.match(branch, /membershipData\.role !== "studio_owner"/);
  assert.match(branch, /collection\("reviewRequests"\)/);
  assert.match(branch, /collection\("albumReminders"\)/);
  assert.match(branch, /status: "paused"/);
  assert.match(branch, /postEventAsksPausedAt: timestamp/);
  assert.match(branch, /action: "project\.reopened"/);
  const release = read("functions/src/post-event/release.ts");
  assert.match(release, /doc\.get\("status"\) !== "paused"/);
  assert.match(release, /postEventAsksPausedAt: null/);
  // A queued review email for a paused ask is held.
  assert.match(read("functions/src/operations/jobs.ts"), /ask\.get\("status"\) === "paused"/);
  // Closing again after a reopen renders the summary again instead of failing.
  assert.match(read("functions/src/post-event/commands.ts"), /batch\.set\(db\.doc\(`pdfJobs\/closeout_/);
});

// ── 3. Move back on the job page ───────────────────────────────────────────

test("every backward move offered is one the state machine allows", () => {
  const now = "2026-10-10T12:00:00.000Z";
  for (const state of states) {
    for (const move of backwardMovesFor(
      { id: "p", state, cancelledFromState: "BOOKED", cancelledAt: "2026-10-09T00:00:00Z" },
      { agreementOut: false, now },
    )) {
      assert.ok(allowedProjectTransitions[state].includes(move.target), `${state}→${move.target}`);
      assert.equal(transitionRoute(state, move.target), move.route, `${state}→${move.target} routed wrong`);
    }
  }
  assert.deepEqual(
    backwardMovesFor({ id: "p", state: "READY" }, { agreementOut: false, now }).map((move) => move.target),
    ["PLANNING"],
  );
});

test("back to the proposal is refused while the agreement is out", () => {
  const now = "2026-10-10T12:00:00.000Z";
  const [move] = backwardMovesFor({ id: "job-1", state: "CONTRACT_PENDING" }, { agreementOut: true, now });
  assert.equal(move?.target, "PROPOSAL");
  assert.equal(move?.blocked?.href, "/studio/booking?project=job-1");
  assert.equal(agreementOutRefusal([{ id: "a", status: "sent", provider: "studiocue" }]), "studiocue");
  assert.equal(agreementOutRefusal([{ id: "a", status: "sent", provider: "docusign" }]), "provider");
  assert.equal(agreementOutRefusal([{ id: "a", status: "completed", provider: "studiocue" }]), "signed");
  assert.equal(agreementOutRefusal([{ id: "a", status: "voided", provider: "studiocue" }]), null);
  assert.match(read("functions/src/crm/commands.ts"), /throw new Error\(`AGREEMENT_OUT:\$\{out\}`\)/);
});

test("LOST, reopening and undoing a cancel have their own commands, not the stage control", () => {
  assert.equal(transitionRoute("PROPOSAL", "LOST"), "closeInquiry");
  assert.equal(transitionRoute("LOST", "PROPOSAL"), "reopenInquiry");
  assert.equal(transitionRoute("LOST", "ARCHIVED"), "transitionProject");
  assert.equal(transitionRoute("CANCELLED", "BOOKED"), "uncancelProject");
  assert.equal(transitionRoute("CANCELLED", "ARCHIVED"), "transitionProject");
  assert.equal(transitionRoute("READY", "PLANNING"), "transitionProject");
  const crm = read("functions/src/crm/commands.ts");
  assert.match(crm, /TRANSITION_HAS_ITS_OWN_COMMAND:\$\{route\}/);
  // Cue's stage card lists only what transitionProject will take.
  assert.match(read("components/ai/actions/job-actions.tsx"), /transitionRoute\(from, to\) === "transitionProject"/);
});

// ── 4. Leads ────────────────────────────────────────────────────────────────

test("a lost lead's link stops working, and a lead can be closed, reopened and restored", () => {
  assert.match(read("functions/src/intake/inquiry-link.ts"), /lead\.get\("status"\) === "lost"/);
  const lead = read("components/live/tenant-records.tsx");
  assert.match(lead, /<ProjectInquiryClose/);
  assert.match(lead, /<InquiryRestore/);
  const crm = read("functions/src/crm/commands.ts");
  const restore = crm.slice(crm.indexOf('command.type === "restoreInquiry"'), crm.indexOf('command.type === "removeIgnoredSender"'));
  assert.match(restore, /\["studio_owner", "studio_admin"\]\.includes\(membershipData\.role\)/);
  assert.match(restore, /INQUIRY_NOT_DISMISSED/);
  // The ignored sender is un-learned only when the studio chose to.
  assert.match(restore, /command\.input\.unignoreSender/);
  assert.match(restore, /state: "LEAD"/);
});

// ── 5. Error copy ──────────────────────────────────────────────────────────

test("a refused move says what the job can do instead", () => {
  const booked = friendlyError(new Error("INVALID_TRANSITION:BOOKED>PLANNING,EVENT_COMPLETE,CANCELLED,POSTPONED"));
  assert.match(booked, /Change the booking/);
  assert.match(booked, /cancel/);
  assert.match(friendlyError(new Error("INVALID_TRANSITION:LEAD>CONSULTATION,CANCELLED")), /From New inquiry|can move to/);
  assert.match(friendlyError(new Error("TRANSITION_HAS_ITS_OWN_COMMAND:closeInquiry")), /Close inquiry/);
  assert.match(friendlyError(new Error("AGREEMENT_OUT:studiocue")), /Withdraw it/);
  assert.doesNotMatch(friendlyError(new Error("FORBIDDEN")), /selected project/);
  assert.match(friendlyError(new Error("PROJECT_ACCESS_DENIED")), /access/);
  assert.match(friendlyError(new Error("OWNER_ONLY_MOVE")), /owner/);
});

test("a couple is told the booking is on hold or no longer active, never a code", () => {
  const base = {
    now: "2026-07-28T12:00:00.000Z",
    proposal: { status: "viewed", expiresAt: "2026-08-05T12:00:00.000Z", packageSnapshotId: "snapshot-1" },
    decision: "accepted",
  } as const;
  assert.throws(
    () => planClientProposalDecision({ ...base, project: { state: "POSTPONED", packageSnapshotId: null } } as never),
    /PROJECT_ON_HOLD/,
  );
  for (const state of ["CANCELLED", "LOST", "ARCHIVED"])
    assert.throws(
      () => planClientProposalDecision({ ...base, project: { state, packageSnapshotId: null } } as never),
      /PROJECT_NOT_ACTIVE/,
    );
  const views = read("components/client/live-client-views.tsx");
  assert.match(views, /PROJECT_ON_HOLD:/);
  assert.match(views, /PROPOSAL_ERROR_FALLBACK : error/);
  assert.match(read("app/api/client/portal/route.ts"), /error === "PROJECT_NOT_ACTIVE"/);
});
