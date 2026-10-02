import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  recommendedFieldCount,
  recommendedQuestionnaires,
} from "@/features/questionnaires/recommended-templates";
import { isTbd, shiftClock, suggestedTime, TBD } from "@/features/questionnaires/field-extras";
import { questionnaireFieldSchema } from "@/features/questionnaires/schema";
import { parseQuestionnaireSections } from "@/features/questionnaires/client-form";
import { eventDetailCategory, eventDetailsFrom } from "@/features/contracts/event-details";
import { lockingFieldIds } from "@/features/planning/details-lock";
import {
  coupleRoleChoices,
  coupleRoleField,
  factForField,
  jobFactSheet,
  prefillFromFacts,
  unmatchedFields,
} from "../functions/src/planning/job-facts.ts";
import { parseRoleChoices, roleChoiceFieldIds, roleChoicesOpen } from "@/components/client/kit/role-chooser";
import { applyCoupleAnswers, coupleFormSections } from "../functions/src/intake/inquiry-form.ts";

/**
 * GR Productions' wedding forms (2026-10-02), offered to every studio as
 * StudioCue's recommendation: the event details form with a TBD option, and
 * the final schedule that asks it all again and lays out the day.
 */

const [details, finalSchedule] = recommendedQuestionnaires();
const fields = (form: typeof details) => form.sections.flatMap((section) => section.fields);

test("the functions copy of field-extras is identical", () => {
  assert.equal(
    readFileSync("functions/src/planning/field-extras.ts", "utf8"),
    readFileSync("features/questionnaires/field-extras.ts", "utf8"),
  );
});

test("TBD, and times that follow another", () => {
  for (const value of ["TBD", "tbd", " TBC ", "To be decided", "to be confirmed"]) assert.equal(isTbd(value), true, value);
  for (const value of ["", "4pm", "TBD at the church", null, 3]) assert.equal(isTbd(value), false, String(value));
  assert.equal(shiftClock("16:30", -30), "16:00");
  assert.equal(shiftClock("00:10", -30), null, "never into the day before");
  assert.equal(shiftClock(TBD, -30), null);
  assert.equal(suggestedTime({ suggestedFrom: { fieldId: "end", minutes: -30 } }, { end: "13:00" }), "12:30");
  assert.equal(suggestedTime({ suggestedFrom: { fieldId: "end", minutes: -30 } }, { end: TBD }), null);
  assert.equal(suggestedTime({}, { end: "13:00" }), null);
});

test("both forms are valid templates, with ids that line up with what reads them", () => {
  assert.equal(details.id, "wedding-event-details");
  assert.equal(finalSchedule.id, "wedding-final-schedule");
  for (const form of [details, finalSchedule]) {
    const ids = fields(form).map((field) => field.id);
    assert.equal(new Set(ids).size, ids.length, `${form.name}: ids are unique`);
    for (const field of fields(form)) questionnaireFieldSchema.parse(field);
    assert.equal(recommendedFieldCount(form), ids.length);
    // A suggested time follows an earlier time in the same form.
    for (const [index, field] of fields(form).entries()) {
      if (!field.suggestedFrom) continue;
      const source = fields(form).findIndex((candidate) => candidate.id === field.suggestedFrom!.fieldId);
      assert.ok(source >= 0 && source < index, `${field.id} follows an earlier question`);
      assert.equal(fields(form)[source]!.type, "time");
      assert.equal(field.type, "time");
    }
  }
  // The run-of-show generator's ids (components/planning/ai-schedule-generator.tsx).
  const finalIds = new Set(fields(finalSchedule).map((field) => field.id));
  for (const id of ["getting-ready", "ceremony-time", "reception-time", "first-look-time", "dinner-time", "cake-cutting-time", "coverageStartTime", "coverageEndTime"])
    assert.ok(finalIds.has(id), id);
});

test("TBD at the inquiry, not on the final schedule", () => {
  const tbd = fields(details).filter((field) => field.allowTbd).map((field) => field.id);
  assert.ok(tbd.includes("getting-ready") && tbd.includes("ceremony-time") && tbd.includes("guest-count"));
  assert.ok(!tbd.includes("event-date") && !tbd.includes("bride-email"), "contacts and the date are known");
  assert.equal(fields(finalSchedule).some((field) => field.allowTbd), false);
});

test("the final schedule asks the event details in the same words, so the earlier answers fill it in", () => {
  const detailLabels = fields(details).map((field) => field.label);
  const finalLabels = fields(finalSchedule).map((field) => field.label);
  assert.deepEqual(finalLabels.slice(0, detailLabels.length), detailLabels);

  // A couple answered the event details on the inquiry page: two things TBD.
  const given: Record<string, unknown> = {
    "event-date": "2027-06-12",
    "bride-name": "Priya Shah",
    "getting-ready": "The Inn at Hudson, Suite 4",
    "bridal-prep-start": "09:00",
    "bridal-prep-end": "13:00",
    "groom-prep-location": TBD,
    "ceremony-time": "16:00",
    "cocktail-hour-time": TBD,
    "reception-time": "18:00",
    coverageEndTime: "22:00",
  };
  const sheet = jobFactSheet({
    projectId: "p1",
    project: { eventDate: "2027-06-12", eventType: "Wedding" },
    leadId: null,
    lead: null,
    contacts: [],
    vendors: [],
    // A run of show that disagrees: the couple's own answer wins on their form.
    schedule: { id: "s1", data: { timezone: "UTC", items: [{ title: "Ceremony", startAt: "2027-06-12T17:00:00.000Z" }] } },
    responses: [
      {
        id: "r-details",
        data: { status: "submitted", templateSnapshot: { sections: details.sections }, answers: given, answerProvenance: {} },
      },
    ],
  });
  const { answers, answerProvenance } = prefillFromFacts({ sheet, sections: finalSchedule.sections });
  assert.equal(answers["getting-ready"], "The Inn at Hudson, Suite 4");
  assert.equal(answers["bride-name"], "Priya Shah");
  assert.equal(answers["bridal-prep-end"], "13:00");
  assert.equal(answers["groom-prep-location"], undefined, "TBD is asked again, not copied");
  // The day in order, from Gabe's rules.
  assert.equal(answers["details-with-bride-time"], "12:30", "30 minutes before prep ends");
  assert.equal(answers["touch-ups-time"], "13:00", "end of prep");
  assert.equal(answers["hide-time"], "15:30", "30 minutes before the ceremony");
  assert.equal(answers["ceremony-run-time"], "16:00");
  assert.equal(answers["cocktail-run-time"], undefined, "cocktails were TBD");
  assert.equal(answers["entrances-time"], "18:00", "the first hour of the reception");
  assert.equal(answers["night-pictures-time"], "21:30", "the last 30 minutes of coverage");
  assert.equal(answers["dinner-time"], undefined, "no rule: check with the venue");
  assert.equal((answerProvenance["hide-time"] as { label: string }).label, "the times you gave us");
  // Nothing filled is ever passed on as if the couple said it.
  assert.equal((answerProvenance["hide-time"] as { verified: boolean }).verified, false);
  // A suggested time isn't put to the AI map.
  assert.equal(unmatchedFields(finalSchedule.sections).some((field) => field.id === "hide-time"), false);
});

test("the booking's own facts fill the questions they plainly ask", () => {
  const byId = new Map(fields(details).map((field) => [field.id, field]));
  assert.equal(factForField(byId.get("event-date")!), "event_date");
  assert.equal(factForField(byId.get("ceremony-time")!), "ceremony_time");
  assert.equal(factForField(byId.get("guest-count")!), "guest_count");
  assert.equal(factForField(byId.get("coverageStartTime")!), null, "coverage hours are not the videographer");
  assert.equal(factForField(byId.get("reception-location")!), null);
});

test("Schedule A and the lock sort every where and when", () => {
  const sorted = (label: string) => eventDetailCategory(label);
  for (const field of fields(finalSchedule)) {
    const category = sorted(field.label);
    if (field.type === "time") assert.equal(category, "times", field.label);
  }
  assert.equal(sorted("Bridal prep location"), "getting_ready");
  assert.equal(sorted("Groom prep location"), "getting_ready");
  assert.equal(sorted("Ceremony location"), "ceremony");
  assert.equal(sorted("Reception location"), "reception");
  assert.equal(sorted("Number of invited guests"), "guests");
  const locks = lockingFieldIds(finalSchedule.sections);
  assert.ok(locks.has("details-with-bride-time") && locks.has("getting-ready") && locks.has("reception-location"));
  for (const id of ["bride-phone", "guest-count", "bride-family-names", "event-date"]) assert.equal(locks.has(id), false, id);
});

test("TBD reads 'To be confirmed' in the agreement, and still counts as missing", () => {
  const schedule = eventDetailsFrom({
    eventType: "Wedding",
    date: "Saturday, June 12, 2027",
    venue: null,
    coverage: null,
    answers: [
      { question: "Bridal prep location", answer: TBD },
      { question: "Ceremony location", answer: "St. Mary's, Hudson" },
      { question: "Ceremony start time", answer: "4:00 PM" },
      { question: "Reception location", answer: "tbd" },
    ],
  });
  assert.deepEqual(
    schedule.rows.filter((row) => ["Getting ready", "Reception"].includes(row.label)),
    [
      { label: "Getting ready", value: "To be confirmed" },
      { label: "Reception", value: "To be confirmed" },
    ],
  );
  assert.deepEqual(schedule.missing, ["Getting ready", "Reception"]);
});

test("the couple can answer TBD where it's offered, and only there", () => {
  const sections = coupleFormSections(details.sections);
  const prep = sections.flatMap((section) => section.fields).find((field) => field.id === "bridal-prep-start")!;
  assert.equal(prep.allowTbd, true);
  const coverage = sections.flatMap((section) => section.fields).find((field) => field.id === "coverageStartTime")!;
  assert.match(coverage.help ?? "", /main photographer/);
  const saved = applyCoupleAnswers({
    sections,
    prior: {},
    incoming: { "bridal-prep-start": "tbd", "event-date": TBD, "groom-prep-location": "To be decided" },
  });
  assert.equal(saved.answers["bridal-prep-start"], TBD);
  assert.equal(saved.answers["groom-prep-location"], TBD);
  assert.equal(saved.answers["event-date"], undefined, "the date isn't a TBD question");
  assert.ok(!saved.missing.includes("Bridal prep start time"), "TBD is an answer");

  // The portal's form reads the same options.
  const parsed = parseQuestionnaireSections(finalSchedule.sections).flatMap((section) => section.fields);
  const hide = parsed.find((field) => field.id === "hide-time")!;
  assert.deepEqual(hide.suggestedFrom, { fieldId: "ceremony-time", minutes: -30 });
  assert.match(hide.help ?? "", /30 minutes before the ceremony/);
});

test("'Which are you?': one tap places the person who inquired and their partner", () => {
  // Gabe's labels, and the variants studios write.
  assert.deepEqual(coupleRoleField({ label: "Bride's name", type: "text" }), { role: "bride", detail: "name" });
  assert.deepEqual(coupleRoleField({ label: "Groom Phone:", type: "text" }), { role: "groom", detail: "phone" });
  assert.deepEqual(coupleRoleField({ label: "Bride Email", type: "text" }), { role: "bride", detail: "email" });
  for (const label of ["Bride's family names", "Bridal prep location", "Groom prep location", "Bride and groom first dance song", "Your name"])
    assert.equal(coupleRoleField({ label, type: "text" }), null, label);

  // GR's contact form: one name, an email, a phone — and a partner named on the inquiry page.
  const sheet = jobFactSheet({
    projectId: "p1",
    project: { eventDate: "2027-06-12" },
    leadId: "l1",
    lead: { firstName: "Riley", lastName: "Moss", email: "riley@example.com", phone: "555 019 9876", partnerName: "Sam Lee" },
    contacts: [],
    vendors: [],
    schedule: null,
    responses: [],
  });
  const choices = coupleRoleChoices({ sheet, sections: details.sections, existing: { "bride-phone": "555 000 1111" } })!;
  assert.deepEqual(choices.bride, { "bride-name": "Riley Moss", "bride-email": "riley@example.com", "groom-name": "Sam Lee" });
  assert.deepEqual(choices.groom, {
    "bride-name": "Sam Lee",
    "groom-name": "Riley Moss",
    "groom-phone": "555 019 9876",
    "groom-email": "riley@example.com",
  });
  // Nothing to offer when the job knows nothing about who wrote in.
  const empty = jobFactSheet({ projectId: "p1", project: {}, leadId: null, lead: null, contacts: [], vendors: [], schedule: null, responses: [] });
  assert.equal(coupleRoleChoices({ sheet: empty, sections: details.sections }), null);
  // Nor on a form that doesn't ask by role.
  assert.equal(coupleRoleChoices({ sheet, sections: [{ fields: [{ id: "n", label: "Your name", type: "text" }] }] }), null);

  // The page shows it while any of it is still blank.
  const parsed = parseRoleChoices(choices)!;
  assert.ok(roleChoiceFieldIds(parsed).has("groom-email"));
  assert.equal(roleChoicesOpen(parsed, {}), true);
  // Once they've picked (or typed one of those answers), it goes — even with the partner's left blank.
  assert.equal(roleChoicesOpen(parsed, { "bride-name": "Riley Moss", "bride-email": "riley@example.com" }), false);
  assert.equal(parseRoleChoices({ bride: {}, groom: {} }), null);
});
