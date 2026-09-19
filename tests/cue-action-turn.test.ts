import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * When Cue is asked to *do* something, the doing is the answer.
 *
 * From live use: "add albert gershengoren to 2nd photogrpaher for erin and joe
 * demattia" produced a one-line answer, then a readiness audit of six unrelated
 * blocked checkpoints — final balance, questionnaire, venue — and only then,
 * below verified facts, citations and prepared drafts, the control that
 * actually staffs the role. It read as six problems in reply to one request,
 * and the operator asked four times in total.
 *
 * Asserted against source: these are render-order and prop-threading rules in
 * a "use client" component that pulls in Firebase, so there is no seam to call.
 * Same approach as tests/refresh-after-write.test.ts.
 */
const workspace = readFileSync(
  `${process.cwd()}/components/ai/copilot-workspace.tsx`,
  "utf8",
);
const runner = readFileSync(
  `${process.cwd()}/components/ai/flow-runner.tsx`,
  "utf8",
);

const turn = (): string => {
  const start = workspace.indexOf("function AssistantTurn(");
  assert.ok(start > 0, "AssistantTurn must exist");
  return workspace.slice(start, workspace.indexOf("function JobObject("));
};

test("the flow renders before facts, citations and prepared drafts", () => {
  const body = turn();
  const flow = body.indexOf("<FlowRunner");
  const facts = body.indexOf("Verified facts");
  const citations = body.indexOf("result.citations.length");
  const prepared = body.indexOf("<PreparedActions");
  assert.ok(flow > 0, "the turn must render a flow");
  for (const [label, at] of [
    ["verified facts", facts],
    ["citations", citations],
    ["prepared actions", prepared],
  ] as Array<[string, number]>) {
    assert.ok(at > 0, `${label} must still render`);
    assert.ok(
      flow < at,
      `the flow must come before ${label} — it is what was asked for`,
    );
  }
});

test("the flow renders only once", () => {
  // It used to sit at the end; moving it must not leave a second copy.
  assert.equal(turn().split("<FlowRunner").length - 1, 1);
});

/** Six unrelated blockers above an action was the reported confusion. */
test("a turn that carries a flow gets the compact job card", () => {
  assert.match(
    turn(),
    /<JobObject[\s\S]{0,120}compact=\{Boolean\(result\.flow\)\}/,
    "JobObject must be told when a flow owns the turn",
  );
  const card = workspace.slice(workspace.indexOf("function JobObject("));
  assert.match(
    card.slice(0, 3000),
    /job\.attention\.length && !compact/,
    "the blocked-checkpoint audit must be suppressed on an action turn",
  );
  assert.match(
    card.slice(0, 3000),
    /r && !compact/,
    "the readiness score must be suppressed on an action turn",
  );
});

// --- the subject the operator named -------------------------------------

test("every flow reads the subject and says when it cannot place it", () => {
  assert.match(runner, /matchSubject\(/);
  // All three flows, each telling the operator what became of the name.
  assert.equal(
    runner.split("unmatchedSubjectNotice(").length - 1,
    3,
    "crew, package and questionnaire must each answer for an unmatched name",
  );
  for (const kind of ['"crew"', '"package"', '"questionnaire"'])
    assert.ok(runner.includes(kind), `${kind} notice missing`);
});

/**
 * Pre-selecting is not pre-sending, and it is only right when there is nothing
 * to weigh: somebody ranked but ineligible keeps the list on screen with their
 * exclusions showing.
 */
test("only an eligible named person skips the picker", () => {
  assert.match(runner, /const namedIsOfferable = Boolean\(namedRanked\?\.eligible\)/);
  assert.match(runner, /namedIsOfferable \? "form" : "select"/);
  assert.match(runner, /namedNeedsReview/);
});

// --- a flow that already acted -------------------------------------------

/**
 * `sent` is local state, so re-opening a thread rendered the picker afresh as
 * though nothing had happened. The assignment is the durable record.
 */
test("a job that already has a live offer shows what happened, not a picker", () => {
  const crew = runner.slice(runner.indexOf("function CrewOfferFlow"));
  assert.match(crew, /liveOnThisJob/);
  assert.match(
    crew,
    /LIVE_OFFER_STATUSES\.has\(str\(item\.status\)\)/,
    "done-ness must come from the assignment's own status",
  );
  // And it must stay escapable — staffing a second person is legitimate.
  assert.match(crew, /setReopened\(true\)/);
});

test("lapsed offers still allow a fresh one", () => {
  // declined/expired/reassigned are deliberately outside LIVE_OFFER_STATUSES,
  // which is the rule features/crew/offer-moment.ts keeps.
  const set = runner.slice(
    runner.indexOf("const LIVE_OFFER_STATUSES"),
    runner.indexOf("const LIVE_OFFER_STATUSES") + 260,
  );
  for (const lapsed of ["declined", "expired", "reassigned"])
    assert.ok(!set.includes(`"${lapsed}"`), `${lapsed} must not lock the job`);
});
