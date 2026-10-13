import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { twelveHourClock, twelveHourTimes } from "@/features/ai/clock-words";
import { checkNote, uncertainItem } from "@/features/ai/check-note";
import { tradeVocab } from "@/features/trades/trades";
import { consultationEmailPlan, trialNeedsPlace } from "../functions/src/booking/consultation-email";
import { renderEmailTemplate } from "../functions/src/communications/email-templates";
import { jobFactSheet } from "../functions/src/planning/job-facts";
import {
  answerForPeople,
  SETTLED_FACTS_INSTRUCTION,
  settledAtTrial,
  settledJobFacts,
} from "../functions/src/planning/questionnaire-review-facts";
import { TWELVE_HOUR_INSTRUCTION, US_ENGLISH_INSTRUCTION } from "../functions/src/ai/language";

/**
 * Cue's planning words, from the prod walk of 2026-10-12 (Jess Styles Bridal,
 * hair; client Priya Shah):
 *
 *   F19 — the planning flags and the follow-up's check note said "earliest
 *         setup time of 07:30 and ready-by time of 12:30";
 *   F20 — the party-list flags asked what color, length or brand of clip-in
 *         extensions, though the trial notes already said "Buying them",
 *         "#4 dark brown, 20 inches";
 *   F22 — the hair trial's confirmation (email and portal message) promised
 *         "any final meeting details", as if the trial were a call.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const between = (source: string, start: string, end: string) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, start);
  const to = source.indexOf(end, from);
  assert.ok(to > from, end);
  return source.slice(from, to);
};

const PHOTO_WORDS =
  /\b(photos?|photograph(?:s|y|ers?|ing)?|galler(?:y|ies)|shoots?|shooting|shot lists?|albums?|coverage|deliverables?|second shooters?|sneak peeks?|images?|editing|retouching|post-production)\b/i;

// ── F19: 12-hour times ──────────────────────────────────────────────────

test("the functions copy of clock-words matches features/", () => {
  const below = (source: string) => source.slice(source.indexOf("// ── mirrored below ──"));
  assert.equal(below(read("functions/src/ai/clock-words.ts")), below(read("features/ai/clock-words.ts")));
});

test("a time field's 24-hour time reads in 12-hour form", () => {
  assert.equal(twelveHourClock("07:30"), "7:30 AM");
  assert.equal(twelveHourClock("12:30"), "12:30 PM");
  assert.equal(twelveHourClock("00:15"), "12:15 AM");
  assert.equal(twelveHourClock("16:00"), "4:00 PM");
  // A time field's value is 24-hour whatever its hour: 10:00 is the morning.
  assert.equal(twelveHourClock("10:00"), "10:00 AM");
  assert.equal(twelveHourClock("9:05"), "9:05 AM");
  for (const value of ["TBD", "", "25:00", "12:75", "7:30 AM", "noon"]) assert.equal(twelveHourClock(value), value);
});

test("a 24-hour time in text reads in 12-hour form; anything that could be 12-hour is left", () => {
  assert.equal(
    twelveHourTimes("Confirm the earliest setup time of 07:30 and ready-by time of 12:30 leave enough time for the party."),
    "Confirm the earliest setup time of 7:30 AM and ready-by time of 12:30 PM leave enough time for the party.",
  );
  assert.equal(twelveHourTimes("In the chair 13:15–14:45"), "In the chair 1:15 PM–2:45 PM");
  assert.equal(twelveHourTimes("from 07:30, ready by 12:30."), "from 7:30 AM, ready by 12:30 PM.");
  // Already 12-hour, or not a clock time at all.
  for (const unchanged of [
    "Ready by 12:30 PM",
    "Start at 07:30 am",
    "Start at 07:30am",
    "Start at 07:30 a.m.",
    "Music ends at 11:00",
    "Ceremony at 4:30",
    "Shoot in 16:9",
    "The film runs 1:07:30",
    "Sent 2026-10-14T07:30:00Z",
    "Color match: #4 dark brown, 20 inches",
    // A reading's book and chapter, a ratio or a score: a couple's readings
    // are as likely in a planning form as a time is.
    "John 15:12",
    "1 Corinthians 13:13",
    "Romans 12:10",
    "Rom. 12:10",
    "Readings: John 15:12 and 1 Corinthians 13:13",
    "Ratio 16:10",
    "an aspect ratio of 16:10",
    "the final score was 21:14",
  ])
    assert.equal(twelveHourTimes(unchanged), unchanged, unchanged);
  // A reference never has a leading zero, so a name before one is no reason to leave it.
  assert.equal(twelveHourTimes("Priya 07:30, Meera 08:15"), "Priya 7:30 AM, Meera 8:15 AM");
  // Nor is a time after a lowercase word or a label's colon.
  assert.equal(twelveHourTimes("Reading by John at 15:30"), "Reading by John at 3:30 PM");
  assert.equal(twelveHourTimes("Ceremony: 16:00"), "Ceremony: 4:00 PM");
});

test("the check note reads a 24-hour time in 12-hour form (F19)", () => {
  assert.equal(
    checkNote(["The earliest setup time of 07:30 and ready-by time of 12:30 leave five hours for six people"]),
    "Check: The earliest setup time of 7:30 AM and ready-by time of 12:30 PM leave five hours for six people",
  );
  assert.equal(uncertainItem("ready-by time 12:30."), "Ready-by time 12:30 PM");
  // Every card's check note goes through it, so a reading stays a reading.
  assert.equal(checkNote(["Confirm reading John 15:12"]), "Check: Confirm reading John 15:12");
  // What it did before is unchanged.
  assert.equal(uncertainItem("event_date"), "Event date");
  assert.equal(uncertainItem("McKenzie"), "McKenzie");
});

test("the planning form reaches the model with its times for people", () => {
  assert.equal(answerForPeople("time", "07:30"), "7:30 AM");
  assert.equal(answerForPeople("time", "10:00"), "10:00 AM");
  assert.equal(answerForPeople("time", "TBD"), "TBD");
  // Free text goes as the client wrote it: a pattern cannot tell a reading
  // from a time, and the model, told to write 12-hour times, can.
  for (const written of [
    "Bride in the chair at 08:00, ready by 12:30",
    "Ceremony reading: John 15:12 and 1 Corinthians 13:13. Ends 23:00",
  ])
    assert.equal(answerForPeople("long_text", written), written);
  assert.deepEqual(answerForPeople("repeating_group", ["Priya Shah — bride — veil, clip-in extensions", "Meera — 09:00"]), [
    "Priya Shah — bride — veil, clip-in extensions",
    "Meera — 09:00",
  ]);
  assert.deepEqual(answerForPeople("address", { line1: "12 Main St", city: "Hoboken" }), { line1: "12 Main St", city: "Hoboken" });
  assert.equal(answerForPeople("number", 6), 6);
  assert.equal(answerForPeople("time", null), null);
});

test("the 12-hour instruction is its own part, never in the line every prompt carries", () => {
  assert.match(TWELVE_HOUR_INSTRUCTION, /12-hour form with AM or PM/);
  assert.match(TWELVE_HOUR_INSTRUCTION, /never 24-hour/);
  // A schedule prompt returns HH:MM fields and carries the US English line.
  assert.doesNotMatch(US_ENGLISH_INSTRUCTION, /12-hour|24-hour/);
});

// ── F20: what the job already settles ───────────────────────────────────

const sheet = jobFactSheet({
  projectId: "ad0e2895",
  project: { eventDate: "2026-11-14", eventType: "wedding", venueName: "The Grove", state: "BOOKED" },
  leadId: "lead1",
  lead: {
    email: "priya@example.com",
    phone: "555 0100",
    budgetRange: "$1,000–$2,000",
    referralSource: "Instagram",
    // As public-lead.ts saves them (job-facts.ts `inquiryAnswer`).
    customAnswers: [{ questionId: "ready-by", answer: "12:30 PM" }],
  },
  contacts: [{ id: "c1", data: { firstName: "Priya", lastName: "Shah", email: "priya@example.com", phone: "555 0100" } }],
  vendors: [],
  schedule: null,
  responses: [],
});

test("Cue is given the job's settled facts, with times for people and no contact details", () => {
  const facts = settledJobFacts(sheet);
  const byFact = new Map(facts.map((item) => [item.fact, item.value]));
  assert.equal(byFact.get("the wedding or event date"), "2026-11-14");
  assert.equal(byFact.get("the name of the venue where the event (or ceremony) is held"), "The Grove");
  assert.equal(byFact.get("the time everyone having their hair or makeup done must be ready by"), "12:30 PM");
  assert.equal(byFact.get("the full name of the person who booked (the first partner)"), "Priya Shah");
  const all = JSON.stringify(facts);
  for (const privateDetail of ["priya@example.com", "555 0100", "$1,000", "Instagram"]) assert.ok(!all.includes(privateDetail), privateDetail);
  assert.deepEqual(settledJobFacts(null), []);
});

test("Cue is given what the trial settled: the extensions and their color match (F20)", () => {
  assert.deepEqual(
    settledAtTrial({
      look: "Low textured bun, veil under the bun",
      products: "Texturizing spray",
      extensions: "buy",
      colorMatch: "#4 dark brown, 20 inches",
      updatedAt: "2026-10-12T15:00:00.000Z",
      updatedBy: "uid",
    }),
    {
      look: "Low textured bun, veil under the bun",
      productsUsed: "Texturizing spray",
      extensions: "Buying them",
      extensionsColorMatch: "#4 dark brown, 20 inches",
    },
  );
  assert.deepEqual(settledAtTrial({ extensions: "none", colorMatch: "#4" }), { extensions: "No extensions" });
  assert.equal(settledAtTrial(null), null);
  assert.equal(settledAtTrial({ look: "  ", extensions: "maybe" }), null);
  assert.match(SETTLED_FACTS_INSTRUCTION, /Never list any of it as missing, never ask the client for it again/);
  assert.match(SETTLED_FACTS_INSTRUCTION, /extension color or length the trial noted/);
});

test("the questionnaire review hands the model those facts, asks for 12-hour times, and fixes any it misses", () => {
  const worker = read("functions/src/operations/ai-pdf.ts");
  const review = between(worker, "async function runQuestionnaireAnalysis", "async function runInboundReplyDraft");
  assert.match(review, /loadJobFactSheet\(db,\{tenantId:string\(job\.get\("tenantId"\)\),projectId:project\.id,/);
  assert.match(review, /\.catch\(\(\)=>null\)/);
  assert.match(review, /settledJobFacts:settledJobFacts\(factSheet\),/);
  assert.match(review, /settledAtTrial:settledAtTrial\(project\.get\("trialNotes"\)\),/);
  assert.match(review, /answer:answerForPeople\(string\(field\.type\),answers\[string\(field\.id\)\]\?\?null\)/);
  // A photographer's too: the times and the asking again were never only a
  // vendor's. Added after the pinned text, which reads as it did
  // (tests/trade-ai-drafts.test.ts).
  assert.match(review, /requires studio review\.`\+tradeInstruction\(trade\)\+SETTLED_FACTS_INSTRUCTION\},US_ENGLISH_PART,TWELVE_HOUR_PART\]/);
  // What comes back: the flags, the summary and the client's follow-up.
  assert.match(review, /map\(item=>twelveHourTimes\(item\.trim\(\)\)\)/);
  assert.match(review, /summary:twelveHourTimes\(string\(analysis\.summary\)\)/);
  assert.match(review, /const followupSubject=twelveHourTimes\(string\(analysis\.followupSubject\)\)/);
  assert.match(review, /const followupBody=twelveHourTimes\(string\(analysis\.followupBody\)\)/);
  // The facts the schedule is built from keep the form's own values.
  assert.match(review, /planningPackage=\{\n\s+status:"ready_for_review",\n\s+sourceResponseId:responseId,\n\s+facts:categorizedFacts,/);
});

test("the review cards show a stored flag's 24-hour time in 12-hour form", () => {
  // Reviews written before this change still say "07:30".
  for (const path of ["components/planning/questionnaire-review-insights.tsx", "components/planning/questionnaire-response-view.tsx"]) {
    const source = read(path);
    assert.match(source, /import \{ twelveHourTimes \} from "@\/features\/ai\/clock-words";/, path);
    assert.match(source, /\.map\(twelveHourTimes\)/, path);
    assert.match(source, /twelveHourTimes\((?:String|text)\(review\.summary/, path);
  }
});

// ── F22: a trial is in person ───────────────────────────────────────────

const brand = { studioName: "Jess Styles Bridal", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
const render = (key: string, values: Record<string, unknown>) =>
  renderEmailTemplate({ key, brand, recipientName: "Priya Shah", projectName: "Priya & Jordan", values });
const trialValues = {
  trade: "hair",
  purpose: "trial",
  meetingMode: "in_person",
  startsAt: "2026-10-14T14:00:00.000Z",
  timezone: "America/New_York",
  location: null,
  joinUrl: null,
  meetingDetailsPending: false,
};

test("a hair trial's confirmation says it is in person and what to bring, never final meeting details (F22)", () => {
  const confirmed = render("consultation_confirmation", trialValues);
  assert.match(confirmed.text, /We confirmed your hair trial on /);
  // It reads as an email and as the portal message: "reply", not "reply to this email".
  assert.match(confirmed.text, /It's in person\. If you're not sure where to come, just reply and we'll let you know\./);
  assert.match(confirmed.text, /Please bring pictures of looks you love, your veil or hairpiece and any hair accessories you'll wear\./);
  assert.doesNotMatch(confirmed.text, /final meeting details/);
  assert.doesNotMatch(`${confirmed.subject}\n${confirmed.text}`, PHOTO_WORDS);
  // With the studio's in-person place, it says where.
  const placed = render("consultation_confirmation", { ...trialValues, location: "Jess Styles Bridal, 12 Main St, Hoboken." });
  assert.match(placed.text, /It's in person, at Jess Styles Bridal, 12 Main St, Hoboken\.\n/);
  assert.doesNotMatch(placed.text, /Location or meeting details/);
  // The reminder and a new time say the same.
  for (const key of ["consultation_reminder", "consultation_rescheduled"]) {
    const email = render(key, trialValues);
    assert.match(email.text, /Please bring pictures of looks you love, your veil or hairpiece/, key);
    assert.doesNotMatch(email.text, /final meeting details/, key);
  }
});

test("a makeup trial asks for the trade's own things", () => {
  assert.deepEqual(tradeVocab("makeup").trialBring, ["pictures of looks you love"]);
  const confirmed = render("consultation_confirmation", { ...trialValues, trade: "makeup" });
  assert.match(confirmed.text, /We confirmed your makeup trial on /);
  assert.match(confirmed.text, /Please bring pictures of looks you love\./);
  assert.doesNotMatch(confirmed.text, /veil|final meeting details/);
  assert.doesNotMatch(`${confirmed.subject}\n${confirmed.text}`, PHOTO_WORDS);
});

test("the trial invitation brings the same things", () => {
  const invite = (trade: string) =>
    render("consultation_invitation", { trade, purpose: "trial", actionUrl: "https://studio-cue.com/x" }).text;
  assert.match(
    invite("hair"),
    /Bring pictures of looks you love, your veil or hairpiece and any hair accessories you'll wear, and we'll get your look just right before the day\./,
  );
  assert.match(invite("makeup"), /Bring pictures of looks you love, and we'll get your look just right before the day\./);
});

test("a photographer's consultation and a vendor's call read as before", () => {
  for (const trade of ["photographer", "dj"]) assert.equal(tradeVocab(trade).trialBring, null);
  const photo = render("consultation_confirmation", { meetingMode: "in_person", startsAt: "2026-10-14T14:00:00.000Z", timezone: "America/New_York" });
  assert.match(photo.text, /We confirmed your consultation on /);
  assert.match(photo.text, /We'll share any final meeting details before the appointment\./);
  assert.doesNotMatch(photo.text, /Please bring|It's in person/);
  const placed = render("consultation_confirmation", { meetingMode: "in_person", location: "Studio, 1 Elm St", startsAt: "2026-10-14T14:00:00.000Z" });
  assert.match(placed.text, /Location or meeting details: Studio, 1 Elm St/);
  // A hair stylist's ordinary call is not a trial.
  const call = render("consultation_confirmation", { ...trialValues, purpose: "consultation" });
  assert.doesNotMatch(call.text, /Please bring|It's in person/);
  // A trial booked as a video call, a phone call or on the studio's own
  // details keeps that way's line; only an in-person one says "in person".
  const video = render("consultation_confirmation", { ...trialValues, meetingMode: "zoom", joinUrl: "https://zoom.us/j/1", location: "https://zoom.us/j/1" });
  assert.match(video.text, /It's a video call\. Join with the button below at the time\./);
  assert.match(video.text, /Please bring pictures of looks you love/);
  const pending = render("consultation_confirmation", { ...trialValues, meetingMode: "zoom", meetingDetailsPending: true });
  assert.match(pending.text, /we'll send you the link to join/);
  const phone = render("consultation_confirmation", { ...trialValues, meetingMode: "phone", location: "555 0100" });
  assert.match(phone.text, /We'll call you on 555 0100\./);
  const custom = render("consultation_confirmation", { ...trialValues, meetingMode: "custom", location: "Suite 4, 12 Main St" });
  assert.match(custom.text, /Location or meeting details: Suite 4, 12 Main St/);
  for (const other of [video, pending, phone, custom]) assert.doesNotMatch(other.text, /It's in person/);
});

test("a canceled trial says there's no need to come in and offers another trial, not a talk", () => {
  const canceled = render("consultation_cancelled", trialValues);
  assert.match(canceled.text, /We've canceled your hair trial on .+, so there's no need to come in\./);
  // Read as an email and as the portal message: "reply", not "reply to this email".
  assert.match(canceled.text, /If you'd still like a trial, reply and we'll find another time\./);
  assert.doesNotMatch(canceled.text, /no need to join|still like to talk/);
  assert.doesNotMatch(`${canceled.subject}\n${canceled.text}`, PHOTO_WORDS);
  const selfServe = render("consultation_cancelled", { ...trialValues, trade: "makeup", rescheduleUrl: "https://studio-cue.com/i/x" });
  assert.match(selfServe.text, /We've canceled your makeup trial on /);
  assert.match(selfServe.text, /If you'd still like a trial, pick another time that suits you\./);
  // A trial booked as a video call still had something to join.
  const video = render("consultation_cancelled", { ...trialValues, meetingMode: "zoom", joinUrl: "https://zoom.us/j/1" });
  assert.match(video.text, /so there's no need to join\./);
  assert.match(video.text, /If you'd still like a trial, reply/);
});

test("a photographer's canceled consultation and a vendor's canceled call read as before", () => {
  const startsAt = "2026-10-14T14:00:00.000Z";
  const photo = render("consultation_cancelled", { meetingMode: "in_person", startsAt, timezone: "America/New_York" });
  assert.match(photo.text, /We've canceled your consultation on .+, so there's no need to join\./);
  assert.match(photo.text, /If you'd still like to talk, reply to this email and we'll find another time\./);
  const moved = render("consultation_cancelled", { startsAt, rescheduleUrl: "https://studio-cue.com/i/x" });
  assert.match(moved.text, /If you'd still like to talk, pick another time that suits you\./);
  // A hair stylist's ordinary call, and a DJ's: not a trial.
  for (const values of [{ ...trialValues, purpose: "consultation" }, { ...trialValues, trade: "dj" }]) {
    const call = render("consultation_cancelled", values);
    assert.match(call.text, /so there's no need to join\./, JSON.stringify(values));
    assert.match(call.text, /If you'd still like to talk, reply to this email/, JSON.stringify(values));
  }
});

test("a trial booked from its link takes the studio's in-person place", () => {
  const scheduling = read("functions/src/booking/public-scheduling.ts");
  const booking = between(scheduling, "const consultationId = `consultation_${hash(`${link.id}:${selected.startsAt}`).slice(0, 32)}`;", "calendarEventId: null,");
  // Only a trial: a photographer's call booked from its link reads as it always has.
  assert.match(
    booking,
    /link\.get\("mode"\) === "in_person" && consultationPurpose\(link\.data\(\)\) === "trial"\s+\? await getConsultationSettings\(db, String\(link\.get\("tenantId"\)\)\)/,
  );
  assert.match(booking, /settings\.inPersonLocation \?\? null/);
  assert.match(booking, /\.catch\(\(\) => null\)/);
  assert.match(booking, /\n\s+location,\n/);
});

test("a trial booked before that names the studio's place when its email goes", () => {
  const trial = {
    tenantId: "t1",
    purpose: "trial",
    mode: "in_person",
    status: "scheduled",
    startsAt: "2026-10-14T14:00:00.000Z",
    location: null,
    joinUrl: null,
    providerState: "completed",
  };
  const place = "Jess Styles Bridal, 12 Main St, Hoboken";
  assert.equal(trialNeedsPlace(trial), true);
  const plan = consultationEmailPlan({
    type: "consultation_reminder",
    job: {},
    consultation: trial,
    resourcesJobStatus: "succeeded",
    attempt: 1,
    maxAttempts: 5,
    inPersonPlace: place,
  });
  assert.equal(plan.kind, "send");
  if (plan.kind !== "send") return;
  assert.equal(plan.values.location, place);
  assert.match(
    render("consultation_reminder", { ...plan.values, trade: "hair" }).text,
    /It's in person, at Jess Styles Bridal, 12 Main St, Hoboken\./,
  );
  // A place of its own wins, and nothing but an in-person trial takes the studio's.
  for (const consultation of [
    { ...trial, location: "The bride's home, 4 Elm St" },
    { ...trial, purpose: "consultation" },
    { ...trial, purpose: "final_details" },
    { ...trial, mode: "zoom" },
    { ...trial, mode: "phone" },
  ]) {
    assert.equal(trialNeedsPlace(consultation), false, JSON.stringify(consultation));
    const other = consultationEmailPlan({
      type: "consultation_reminder",
      job: {},
      consultation,
      resourcesJobStatus: "succeeded",
      attempt: 5,
      maxAttempts: 5,
      inPersonPlace: place,
    });
    assert.equal(other.kind, "send");
    if (other.kind === "send") assert.notEqual(other.values.location, place, JSON.stringify(consultation));
  }
  // The studio's settings are read only for a trial that needs them, and a
  // failed read sends the email as it was.
  const source = read("functions/src/booking/consultation-email.ts");
  const reader = between(source, "export async function consultationEmailPlanFor", "return consultationEmailPlan({");
  assert.match(reader, /trialNeedsPlace\(data\) && !text\(input\.job\.location\)\s+\? await getConsultationSettings\(/);
  assert.match(reader, /\.catch\(\(\) => null\)/);
});

test("a bare 24-hour time goes to the review as 12-hour, whatever field it landed in", async () => {
  const { answerForPeople } = await import("../functions/src/planning/questionnaire-review-facts");
  assert.equal(answerForPeople("text", "10:00"), "10:00 AM");
  assert.equal(answerForPeople("short_text", "23:00"), "11:00 PM");
  assert.equal(answerForPeople("text", "after 10:00"), "after 10:00");
});
