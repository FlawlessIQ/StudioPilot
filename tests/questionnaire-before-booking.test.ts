import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  calendarDay,
  questionnaireDueDate,
  QUESTIONNAIRE_DUE_DAYS_WITHOUT_EVENT_DATE,
} from "../functions/src/planning/questionnaire-due.ts";
import {
  QUESTIONNAIRE_PATH,
  questionnaireLinkPlan,
} from "../functions/src/planning/questionnaire-link.ts";
import { mintClientInvitation } from "../functions/src/client/invitation-mint.ts";
import { questionnaireAssignNotice } from "@/features/questionnaires/assign-notice";
import { friendlyError } from "@/lib/ai/friendly-error";

/**
 * Sending the event form to an inquiry, before the consultation.
 *
 * GR Productions sends its "Wedding event form" right after an inquiry. Two
 * things stood in the way:
 *
 *  4a. The due date was `new Date(`${eventDate}T12:00:00.000Z`)`, which for a
 *      job with no date is an Invalid Date — and `toISOString()` threw
 *      "Invalid time value" at the studio. Nothing was sent.
 *  4b. The email linked to /client/questionnaire, an authenticated portal
 *      route. A couple who had not been invited to the portal (every inquiry)
 *      landed on a sign-in page for an account nobody had made. Proposals and
 *      agreements already carried their own portal invitation for this; the
 *      questionnaire now does too.
 */

test("4a: the old due-date construction throws for a job with no date", () => {
  for (const eventDate of [undefined, null, ""]) {
    const due = new Date(`${String(eventDate)}T12:00:00.000Z`);
    assert.throws(() => due.toISOString(), RangeError);
  }
});

test("4a: no event date — due a week after it is sent", () => {
  for (const eventDate of [undefined, null, "", "TBD", "2026-02-30", 20270612, {}]) {
    assert.deepEqual(
      questionnaireDueDate({ eventDate, dueDaysBeforeEvent: 30, today: "2026-10-01" }),
      { dueDate: "2026-10-08", countedFrom: "sent_date" },
      `eventDate ${JSON.stringify(eventDate)}`,
    );
  }
  assert.equal(QUESTIONNAIRE_DUE_DAYS_WITHOUT_EVENT_DATE, 7);
});

test("4a: the command passes a timestamp as today; the day is taken from it", () => {
  assert.deepEqual(
    questionnaireDueDate({
      eventDate: null,
      dueDaysBeforeEvent: 30,
      today: "2026-12-28T15:04:05.000Z",
    }),
    { dueDate: "2027-01-04", countedFrom: "sent_date" },
  );
});

test("4a: with an event date, counted back from it as before", () => {
  assert.deepEqual(
    questionnaireDueDate({ eventDate: "2027-06-12", dueDaysBeforeEvent: 30, today: "2026-10-01" }),
    { dueDate: "2027-05-13", countedFrom: "event_date" },
  );
  // Across a month and a year boundary.
  assert.equal(
    questionnaireDueDate({ eventDate: "2027-01-10", dueDaysBeforeEvent: 21, today: "2026-10-01" }).dueDate,
    "2026-12-20",
  );
  // A missing or nonsense offset is the event day itself, as it was.
  for (const dueDaysBeforeEvent of [undefined, null, "x", -5])
    assert.equal(
      questionnaireDueDate({ eventDate: "2027-06-12", dueDaysBeforeEvent, today: "2026-10-01" }).dueDate,
      "2027-06-12",
    );
  // A stored timestamp still reads as its day.
  assert.equal(
    questionnaireDueDate({ eventDate: "2027-06-12T00:00:00.000Z", dueDaysBeforeEvent: 0, today: "2026-10-01" }).dueDate,
    "2027-06-12",
  );
});

test("4a: calendarDay refuses days that do not exist", () => {
  assert.equal(calendarDay("2028-02-29"), "2028-02-29");
  assert.equal(calendarDay("2027-02-29"), null);
  assert.equal(calendarDay("2027-13-01"), null);
  assert.equal(calendarDay("June 12"), null);
});

test("4a: the assign command uses the helper, not the throwing construction", () => {
  const source = readFileSync("functions/src/planning/commands.ts", "utf8");
  const start = source.indexOf('parsed.type === "assignQuestionnaire"');
  const body =
    source.slice(start, source.indexOf('parsed.type === "saveTimingRule"', start)) +
    // The new form goes out through the module the scheduler shares.
    readFileSync("functions/src/planning/send-questionnaire.ts", "utf8");
  assert.match(body, /questionnaireDueDate\(/);
  assert.doesNotMatch(body, /T12:00:00\.000Z/);
  assert.doesNotMatch(body, /toISOString\(\)\.slice\(0, 10\)/);
  // No stage restriction: an inquiry (LEAD) or a job at consultation can be
  // sent the form, which is the point.
  assert.doesNotMatch(body, /get\("state"\)/);
});

test("4b: a couple with no portal access gets an invitation", () => {
  const base = {
    clientContactId: "contact_1",
    contactEmail: "ava@example.com",
    portalUserId: "",
    memberProjectIds: [] as string[],
    memberActive: false,
    projectId: "project_new",
  };
  assert.equal(questionnaireLinkPlan(base), "invite");
  // In the portal for this job: the plain link works.
  assert.equal(
    questionnaireLinkPlan({
      ...base,
      portalUserId: "uid_1",
      memberActive: true,
      memberProjectIds: ["project_new"],
    }),
    "portal",
  );
  // A returning couple: an account from an earlier job doesn't open this one.
  assert.equal(
    questionnaireLinkPlan({
      ...base,
      portalUserId: "uid_1",
      memberActive: true,
      memberProjectIds: ["project_old"],
    }),
    "invite",
  );
  // A suspended membership is no access.
  assert.equal(
    questionnaireLinkPlan({
      ...base,
      portalUserId: "uid_1",
      memberActive: false,
      memberProjectIds: ["project_new"],
    }),
    "invite",
  );
  // Nobody to attach an invitation to: the plain link, as before.
  assert.equal(questionnaireLinkPlan({ ...base, clientContactId: "" }), "portal");
  assert.equal(questionnaireLinkPlan({ ...base, contactEmail: "" }), "portal");
});

test("4b: the invitation lands on the questionnaire once accepted", () => {
  const invitation = mintClientInvitation({
    tenantId: "tenant_1",
    projectId: "project_1",
    email: " Ava@Example.com ",
    appUrl: "https://studio-cue.com",
    next: QUESTIONNAIRE_PATH,
  });
  const url = new URL(invitation.inviteUrl);
  assert.equal(url.pathname, "/auth/client-invite");
  assert.equal(url.searchParams.get("next"), "/client/questionnaire");
  assert.equal(invitation.email, "ava@example.com");
  // The accept page only honours a landing inside the portal.
  const accept = readFileSync("features/auth/accept-client-invitation.tsx", "utf8");
  assert.match(accept, /landing\.startsWith\("\/client"\)/);
});

test("4b: every questionnaire request or reminder to the couple is built by the link helper", () => {
  const commands = readFileSync("functions/src/planning/commands.ts", "utf8");
  const assign = commands.slice(
    commands.indexOf('parsed.type === "assignQuestionnaire"'),
    commands.indexOf('parsed.type === "saveTimingRule"'),
  );
  assert.equal((assign.match(/questionnaireLinkFor\(/g) ?? []).length, 1, "re-send");
  const sender = readFileSync("functions/src/planning/send-questionnaire.ts", "utf8");
  assert.equal((sender.match(/questionnaireLinkFor\(/g) ?? []).length, 1, "new form");
  assert.doesNotMatch(sender, /\/client\/questionnaire/);
  assert.doesNotMatch(assign, /\/client\/questionnaire/);
  const resend = commands.slice(
    commands.indexOf('parsed.type === "reopenQuestionnaire" ||'),
    commands.indexOf('parsed.type === "assignQuestionnaire"'),
  );
  assert.match(resend, /questionnaireLinkFor\(/);
  const scheduler = readFileSync("functions/src/planning/questionnaire-reminder-scheduler.ts", "utf8");
  assert.match(scheduler, /questionnaireLinkFor\(/);
  assert.doesNotMatch(scheduler, /\/client\/questionnaire/);
});

test("the studio is told what actually happened", () => {
  assert.equal(
    questionnaireAssignNotice({ dueDate: "2026-10-08", dueCountedFrom: "sent_date", invited: true }),
    "Questionnaire sent. There's no date on the job yet, so it's due a week from today (October 8, 2026). The email carries an invitation to their portal, where they fill it in.",
  );
  assert.equal(
    questionnaireAssignNotice({ dueDate: "2027-05-13", dueCountedFrom: "event_date", invited: false }),
    "Questionnaire sent. It's due May 13, 2027, counted back from the event date. They fill it in from their portal.",
  );
  assert.match(questionnaireAssignNotice({ resent: true, invited: true }), /invitation to their portal/);
  assert.doesNotMatch(questionnaireAssignNotice({ resent: true }), /invitation/);
});

test("a refused send reads as a sentence", () => {
  const copy = friendlyError(new Error("QUESTIONNAIRE_ASSIGNMENT_INVALID"), "fallback");
  assert.notEqual(copy, "fallback");
  assert.match(copy, /form/);
});

test("never due before the couple has had a week, nor after the day itself", () => {
  // GR's event details form, due 180 days out, sent four months before.
  assert.deepEqual(questionnaireDueDate({ eventDate: "2027-02-01", dueDaysBeforeEvent: 180, today: "2026-10-01" }), {
    dueDate: "2026-10-08",
    countedFrom: "soonest",
  });
  assert.deepEqual(questionnaireDueDate({ eventDate: "2026-10-04", dueDaysBeforeEvent: 30, today: "2026-10-01" }), {
    dueDate: "2026-10-04",
    countedFrom: "soonest",
  });
  assert.equal(
    questionnaireAssignNotice({ dueDate: "2026-10-08", dueCountedFrom: "soonest" }),
    "Questionnaire sent. Counted back from the event date it would already be due, so it's due October 8, 2026. They fill it in from their portal.",
  );
});
