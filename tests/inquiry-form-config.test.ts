import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  dayFieldsFor,
  defaultInquiryFormConfig,
  inquiryAnswersForLead,
  inquiryIdFor,
  inquiryRequirementIssues,
  inquirySkipsDetails,
  LEGACY_DAY_FIELDS,
  normaliseHexColor,
  normaliseInquiryFormConfig,
  prepareInquiryInput,
  questionsForType,
  resolveInquiryEventType,
  validateInquiryFormConfig,
  type InquiryFormConfig,
} from "@/features/leads/inquiry-form-config";
import { inquiryFormTheme, readableForeground } from "@/features/leads/inquiry-form-theme";
import { publicLeadIntakeSchemaFor } from "@/features/leads/schema";
import { validatePublicLeadIntake } from "@/features/leads/public-intake-validate";
import { leadAnswers } from "@/features/leads/lead-answers";
import { projectThread } from "@/features/journey/thread";
import { contrastRatio } from "@/features/design/studio-theme";
import { inquiryEventKind, inquiryGetsEventForm } from "../functions/src/intake/inquiry-form.ts";

/**
 * The studio's own inquiry form (GR Productions, 2026-10-01): "If Lynn is
 * contacting me about cheer pics, she doesn't need guests, venue, etc." Each
 * studio type says what "your day" asks; the budget and referral questions can
 * go; the studio adds its own questions; it picks its colours. The rule that
 * matters most is the last section here: the server accepts exactly what the
 * page showed — never requires a field it hid, never keeps one.
 */

const read = (path: string) => readFileSync(path, "utf8");
const MARKER = "// ── mirrored below ──";
const body = (path: string) => read(path).slice(read(path).indexOf(MARKER));

test("the functions copy is the same code", () => {
  assert.ok(read("features/leads/inquiry-form-config.ts").includes(MARKER));
  assert.equal(body("functions/src/intake/inquiry-form-config.ts"), body("features/leads/inquiry-form-config.ts"));
  // No imports below the marker, so neither copy needs the other's paths.
  assert.doesNotMatch(body("features/leads/inquiry-form-config.ts"), /^import /m);
});

/* ── Defaults ─────────────────────────────────────────────────────────── */

test("the default form keeps every studio's current behaviour and adds the common kinds", () => {
  const config = defaultInquiryFormConfig();
  assert.deepEqual(
    config.eventTypes.map((type) => [type.id, type.label, type.kind]),
    [
      ["wedding", "Wedding", "wedding"],
      ["portraits", "Portraits", "portraits"],
      ["sports", "Sports", "sports"],
      ["corporate", "Corporate", "corporate"],
      ["other", "Other", "other"],
      ["general", "General question", "general"],
    ],
  );
  // Referral was always asked and still is; budget is off unless the studio turns it on.
  assert.equal(config.askBudget, false);
  assert.equal(config.askReferral, true);
  assert.deepEqual(config.questions, []);
  assert.equal(config.buttonColor, null);
  assert.equal(config.background, "cream");
  // A wedding asks what the form always asked.
  assert.deepEqual(dayFieldsFor(config.eventTypes[0]!), LEGACY_DAY_FIELDS);
  assert.deepEqual(LEGACY_DAY_FIELDS, { eventDate: "required", city: "required", venue: true, guests: true, coi: true });
});

test("a cheer shoot is asked a date and a city, not a venue or a guest count", () => {
  const sports = defaultInquiryFormConfig().eventTypes.find((type) => type.id === "sports")!;
  assert.deepEqual(dayFieldsFor(sports), { eventDate: "optional", city: "optional", venue: false, guests: false, coi: false });
  assert.equal(inquirySkipsDetails(sports), false);
});

test("a general question skips 'your day' altogether", () => {
  const general = defaultInquiryFormConfig().eventTypes.find((type) => type.kind === "general")!;
  assert.equal(inquirySkipsDetails(general), true);
  assert.equal(inquirySkipsDetails(null), false);
  // So does any type the studio strips of every day field.
  assert.equal(
    inquirySkipsDetails({ eventDate: "hidden", city: "hidden", venue: false, guests: false, coi: false }),
    true,
  );
});

/* ── Reading and saving a config ─────────────────────────────────────── */

test("a stored config that can't be read is the default form, never a broken page", () => {
  for (const raw of [null, undefined, "nonsense", 42, [], { eventTypes: "x" }, { eventTypes: [] }])
    assert.deepEqual(normaliseInquiryFormConfig(raw).eventTypes, defaultInquiryFormConfig().eventTypes, String(raw));
});

test("a bad piece is dropped and the rest kept", () => {
  const config = normaliseInquiryFormConfig({
    eventTypes: [
      { id: "cheer", label: "Cheer", kind: "sports", eventDate: "required", city: "optional", venue: false, guests: false, coi: true },
      { id: "", label: "No id", kind: "sports" },
      { id: "x", label: "X", kind: "sports" },
      // A general type asks nothing about the day, whatever was stored.
      { id: "ask", label: "Just a question", kind: "general", eventDate: "required", venue: true },
    ],
    askBudget: false,
    questions: [
      { id: "team", label: "Which team?", type: "short_text", required: true, eventTypeIds: ["cheer", "gone"] },
      { id: "pick", label: "Which package?", type: "choice", options: ["Only one"] },
    ],
    buttonColor: "#abc",
    background: "purple",
  });
  assert.deepEqual(config.eventTypes.map((type) => type.id), ["cheer", "ask"]);
  // No venue, no certificate question.
  assert.equal(config.eventTypes[0]!.coi, false);
  assert.deepEqual(dayFieldsFor(config.eventTypes[1]!), { eventDate: "hidden", city: "hidden", venue: false, guests: false, coi: false });
  assert.equal(config.askBudget, false);
  assert.equal(config.askReferral, true);
  assert.deepEqual(config.questions.map((question) => [question.id, question.eventTypeIds]), [["team", ["cheer"]]]);
  assert.equal(config.buttonColor, "#AABBCC");
  assert.equal(config.background, "cream");
});

const GR: InquiryFormConfig = {
  eventTypes: [
    { id: "wedding", label: "Wedding", kind: "wedding", eventDate: "required", city: "required", venue: true, guests: true, coi: true },
    { id: "sports", label: "Sports", kind: "sports", eventDate: "optional", city: "optional", venue: false, guests: false, coi: false },
    { id: "studio_time", label: "Studio time", kind: "portraits", eventDate: "required", city: "hidden", venue: false, guests: false, coi: false },
    { id: "general", label: "General inquiry", kind: "general", eventDate: "hidden", city: "hidden", venue: false, guests: false, coi: false },
  ],
  askBudget: false,
  askReferral: true,
  questions: [
    { id: "team", label: "Which team or school?", type: "short_text", options: [], required: true, eventTypeIds: ["sports"] },
    { id: "package", label: "Which package interests you?", type: "choice", options: ["Half day", "Full day"], required: false, eventTypeIds: [] },
    { id: "returning", label: "Have we worked together before?", type: "yes_no", options: [], required: false, eventTypeIds: [] },
  ],
  buttonColor: "#C0392B",
  background: "white",
};

test("a studio's own form saves as written", () => {
  const checked = validateInquiryFormConfig(GR);
  assert.equal(checked.ok, true);
  if (checked.ok) assert.deepEqual(checked.config, GR);
});

test("saving says what is wrong, in the studio's words", () => {
  const refuse = (change: Partial<InquiryFormConfig>, pattern: RegExp) => {
    const checked = validateInquiryFormConfig({ ...GR, ...change });
    assert.equal(checked.ok, false, String(pattern));
    if (!checked.ok) assert.ok(checked.errors.some((error) => pattern.test(error)), `${pattern} in ${checked.errors.join(" | ")}`);
  };
  refuse({ eventTypes: [] }, /at least one type/);
  refuse({ eventTypes: [GR.eventTypes[0]!, { ...GR.eventTypes[1]!, label: "wedding" }] }, /Two types are called/);
  refuse({ eventTypes: [{ ...GR.eventTypes[0]!, label: "W" }] }, /name of 2 to 40/);
  refuse({ eventTypes: [{ ...GR.eventTypes[0]!, kind: "party" as never }] }, /needs a kind/);
  refuse({ questions: [{ ...GR.questions[1]!, options: ["Only one", "  "] }] }, /at least two answers/);
  refuse({ questions: [{ ...GR.questions[0]!, label: "?" }] }, /wording of 3 to 200/);
  refuse({ questions: [{ ...GR.questions[0]!, eventTypeIds: ["gone"] }] }, /types that no longer exist/);
  refuse(
    { questions: Array.from({ length: 9 }, (_, index) => ({ ...GR.questions[2]!, id: `q${index}` })) },
    /8 questions or fewer/,
  );
  refuse({ buttonColor: "red" }, /hex colour/);
  refuse({ background: "black" as never }, /cream, white or light grey/);
});

test("saving tidies what the editor holds mid-edit", () => {
  // The options box keeps blank lines while typing; they are not answers.
  const checked = validateInquiryFormConfig({
    ...GR,
    questions: [{ ...GR.questions[1]!, options: ["Half day", "", " Full day ", "Half day", ""] }],
    buttonColor: "#c0392b",
  });
  assert.equal(checked.ok, true);
  if (!checked.ok) return;
  assert.deepEqual(checked.config.questions[0]!.options, ["Half day", "Full day"]);
  assert.equal(checked.config.buttonColor, "#C0392B");
});

test("ids are stable and unique", () => {
  assert.equal(inquiryIdFor("Studio time", []), "studio_time");
  assert.equal(inquiryIdFor("Studio time", ["studio_time"]), "studio_time_2");
  assert.equal(inquiryIdFor("!!!", [], "type"), "type");
  assert.equal(normaliseHexColor(" #0a0 "), "#00AA00");
  assert.equal(normaliseHexColor("#12345"), null);
});

/* ── Which type an inquiry is ────────────────────────────────────────── */

test("the type is found by its key, or by the old free-text type", () => {
  assert.equal(resolveInquiryEventType(GR, { eventTypeKey: "sports" }).type?.label, "Sports");
  assert.deepEqual(resolveInquiryEventType(GR, { eventTypeKey: "gone" }), { type: null, unknownKey: true });
  // A page loaded before types existed posts "wedding", or the label.
  assert.equal(resolveInquiryEventType(GR, { eventType: "wedding" }).type?.id, "wedding");
  assert.equal(resolveInquiryEventType(GR, { eventType: "Studio Time" }).type?.id, "studio_time");
  assert.deepEqual(resolveInquiryEventType(GR, { eventType: "Gala" }), { type: null, unknownKey: false });
  // An unknown type is asked what the form always asked.
  assert.deepEqual(dayFieldsFor(null), LEGACY_DAY_FIELDS);
});

test("questions follow the type they are asked for", () => {
  const sports = GR.eventTypes[1]!;
  assert.deepEqual(questionsForType(GR, sports).map((question) => question.id), ["team", "package", "returning"]);
  assert.deepEqual(questionsForType(GR, GR.eventTypes[0]!).map((question) => question.id), ["package", "returning"]);
  assert.deepEqual(questionsForType(GR, null).map((question) => question.id), ["package", "returning"]);
});

/* ── The server accepts exactly what the page showed ─────────────────── */

const person = {
  tenantSlug: "gr-productions",
  firstName: "Lynn",
  lastName: "Avery",
  email: "lynn@example.com",
  phone: "555 010 1234",
  servicesRequested: ["photography"],
  message: "Cheer competition photos for the squad, please.",
  consent: true,
};

/** Both checks over the same input: they must agree on fields and values. */
function check(input: Record<string, unknown>, config: InquiryFormConfig = GR) {
  const zod = publicLeadIntakeSchemaFor(config).safeParse(input);
  const ours = validatePublicLeadIntake(input, config);
  const zodFields = zod.success ? [] : [...new Set(zod.error.issues.map((issue) => String(issue.path[0])))].sort();
  const ourFields = ours.errors ? [...new Set(Object.keys(ours.errors).map((key) => key.split(".")[0]!))].sort() : [];
  assert.deepEqual(ourFields, zodFields, `refused fields for ${JSON.stringify(input).slice(0, 120)}`);
  if (zod.success) assert.deepEqual(ours.values, zod.data);
  return { zod, ours };
}

test("Lynn's cheer inquiry needs no venue, guests, date or city", () => {
  const { zod } = check({ ...person, eventType: "Sports", eventTypeKey: "sports", customAnswers: { team: "Wildcats" } });
  assert.ok(zod.success);
  if (!zod.success) return;
  assert.equal(zod.data.eventDate, null);
  assert.equal(zod.data.city, null);
});

test("what the chosen type hides is neither checked nor kept", () => {
  // Typed while "Wedding" was chosen, then switched to Sports.
  const { zod } = check({
    ...person,
    eventType: "Sports",
    eventTypeKey: "sports",
    venue: "The Barn",
    estimatedGuestCount: 0, // would be refused if it were checked
    coiRequired: "maybe", // likewise
    venueContactEmail: "planner@",
    budgetRange: "$5,000–$8,000", // GR doesn't ask the budget
    customAnswers: { team: "Wildcats" },
  });
  assert.ok(zod.success);
  if (!zod.success) return;
  assert.equal(zod.data.venue, null);
  assert.equal(zod.data.estimatedGuestCount, null);
  assert.equal(zod.data.coiRequired, null);
  assert.equal(zod.data.venueContactEmail, null);
  assert.equal(zod.data.budgetRange, null);
});

test("a general inquiry is the person and their message", () => {
  const { zod } = check({ ...person, eventType: "General inquiry", eventTypeKey: "general", eventDate: "2027-05-01", city: "Hope" });
  assert.ok(zod.success);
  if (zod.success) {
    assert.equal(zod.data.eventDate, null);
    assert.equal(zod.data.city, null);
  }
  // The date input sends "" when empty: no date, not a bad one.
  assert.ok(check({ ...person, eventType: "General inquiry", eventTypeKey: "general", eventDate: "" }).zod.success);
});

test("what a type requires is still required, in the same words", () => {
  const { ours } = check({ ...person, eventType: "Studio time", eventTypeKey: "studio_time", eventDate: "" });
  assert.equal(ours.errors?.eventDate, "Pick the date of your event.");
  const wedding = check({ ...person, eventType: "Wedding", eventTypeKey: "wedding", eventDate: "2027-06-12", city: " " });
  assert.equal(wedding.ours.errors?.city, "Which city or town is the event in?");
  // A date that is there but impossible is refused for that, not as missing.
  assert.equal(
    check({ ...person, eventType: "Sports", eventTypeKey: "sports", eventDate: "2027-02-30", customAnswers: { team: "W" } }).ours.errors?.eventDate,
    "Pick the date of your event.",
  );
});

test("the studio's own questions: required, chosen from the list, asked only of their type", () => {
  const missing = check({ ...person, eventType: "Sports", eventTypeKey: "sports" });
  assert.equal(missing.ours.errors?.["customAnswers.team"], "Answer this question — it helps the studio reply.");
  // Only Sports is asked about the team; a wedding is not held to it.
  assert.ok(
    check({ ...person, eventType: "Wedding", eventTypeKey: "wedding", eventDate: "2027-06-12", city: "Hope", customAnswers: { team: "Wildcats" } }).zod
      .success,
  );
  const offList = check({ ...person, eventType: "Sports", eventTypeKey: "sports", customAnswers: { team: "W", package: "Two days" } });
  assert.equal(offList.ours.errors?.["customAnswers.package"], "Choose one of the answers.");
  const yesNo = check({ ...person, eventType: "Sports", eventTypeKey: "sports", customAnswers: { team: "W", returning: "maybe" } });
  assert.equal(yesNo.ours.errors?.["customAnswers.returning"], "Choose one of the answers.");
  const tooLong = check({ ...person, eventType: "Sports", eventTypeKey: "sports", customAnswers: { team: "x".repeat(201) } });
  assert.equal(tooLong.ours.errors?.["customAnswers.team"], "Keep this under 200 characters.");
  // Answers to questions nobody asked are dropped, not refused.
  const extra = check({ ...person, eventType: "Sports", eventTypeKey: "sports", customAnswers: { team: " Wildcats ", nope: "x", package: "" } });
  assert.ok(extra.zod.success);
  if (extra.zod.success) assert.deepEqual(extra.zod.data.customAnswers, { team: "Wildcats" });
  // Not an object at all: refused as a whole.
  check({ ...person, eventType: "Sports", eventTypeKey: "sports", customAnswers: "Wildcats" });
});

test("a type the studio has since removed is refused, and said plainly", () => {
  const { ours } = check({ ...person, eventType: "Cheer", eventTypeKey: "cheer" });
  assert.equal(ours.errors?.eventTypeKey, "Choose what you’re getting in touch about.");
  // Nothing chosen at all: the type itself is refused.
  assert.ok(check({ ...person, eventType: "", eventTypeKey: "" }).ours.errors?.eventType);
});

test("an old page's inquiry, with no key, is held to the old form", () => {
  const legacy = { ...person, eventType: "wedding", eventDate: "2027-06-12", city: "Brooklyn" };
  assert.ok(check(legacy).zod.success);
  assert.equal(check({ ...legacy, city: undefined }).ours.errors?.city, "Which city or town is the event in?");
  // The default form is the one the schema and validator have always checked.
  assert.ok(check(legacy, defaultInquiryFormConfig()).zod.success);
});

test("the requirement check alone: nothing reported twice, nothing asked that was hidden", () => {
  const prepared = prepareInquiryInput({ ...person, eventTypeKey: "general", eventDate: "nonsense", city: "N" }, GR) as Record<string, unknown>;
  assert.equal(prepared.eventDate, null);
  assert.equal(prepared.city, null);
  assert.deepEqual(inquiryRequirementIssues(prepared, GR), []);
  // A malformed value present is the schema's to refuse, not "missing".
  assert.deepEqual(inquiryRequirementIssues({ eventTypeKey: "studio_time", eventDate: "nonsense" }, GR), []);
});

test("answers are kept with the question as it was worded", () => {
  const sports = GR.eventTypes[1]!;
  assert.deepEqual(inquiryAnswersForLead(GR, sports, { team: "Wildcats", returning: "yes", package: " ", nope: "x" }), [
    { questionId: "team", question: "Which team or school?", answer: "Wildcats" },
    { questionId: "returning", question: "Have we worked together before?", answer: "Yes" },
  ]);
});

/* ── Colours ─────────────────────────────────────────────────────────── */

test("button text is whichever of white or ink reads better", () => {
  assert.equal(readableForeground("#111111"), "#FFFFFF");
  assert.equal(readableForeground("#FFE066"), "#1D1A16");
});

test("any colour a studio picks stays readable on the background it picked", () => {
  for (const buttonColor of ["#FFE066", "#C0392B", "#00FF00", "#FFFFFF", null]) {
    for (const background of ["cream", "white", "light"] as const) {
      const theme = inquiryFormTheme("#7FB3D5", { buttonColor, background });
      assert.ok(contrastRatio(theme.accent, theme.page) >= 4.5, `${buttonColor} on ${background}: link text`);
      assert.ok(contrastRatio(theme.accent, theme.card) >= 4.5, `${buttonColor} on ${background}: on cards`);
      assert.ok(contrastRatio(theme.onAccent, theme.accent) >= 4.5, `${buttonColor} on ${background}: button text`);
    }
  }
  // A colour that already reads is used exactly.
  assert.equal(inquiryFormTheme(null, { buttonColor: "#1F3A5F", background: "white" }).accent, "#1F3A5F");
  assert.equal(inquiryFormTheme(null, { buttonColor: null, background: "white" }).page, "#FFFFFF");
});

/* ── Where it reaches ────────────────────────────────────────────────── */

test("a studio's wedding type keeps the wedding-only event form, whatever it is called", () => {
  assert.equal(inquiryEventKind({ eventTypeId: "wedding", eventTypeLabel: "Big Day", eventKind: "wedding" }), "wedding");
  assert.equal(inquiryGetsEventForm({ eventTypeId: "wedding", eventTypeLabel: "Big Day", eventKind: "wedding" }), true);
  // A type the studio says isn't a wedding isn't one, even with the word in it.
  assert.equal(inquiryGetsEventForm({ eventTypeLabel: "Wedding portraits", eventKind: "portraits" }), false);
  // Inquiries from before types are read as they always were.
  assert.equal(inquiryEventKind({ eventTypeId: "wedding", eventTypeLabel: "Elopement" }), "wedding");
});

test("the answers show on the inquiry and open the job's thread", () => {
  const lead = {
    id: "lead-1",
    createdAt: "2026-10-01T10:00:00.000Z",
    message: "Cheer photos please.",
    customAnswers: [{ questionId: "team", question: "Which team or school?", answer: "Wildcats" }, { question: 3 }],
  };
  assert.deepEqual(leadAnswers(lead), [{ question: "Which team or school?", answer: "Wildcats" }]);
  assert.deepEqual(leadAnswers({}), []);
  const [first] = projectThread({ projectId: "p1", projectName: "Lynn", projectCreatedAt: null, clientName: "Lynn", lead });
  assert.deepEqual(first?.answers, [{ question: "Which team or school?", answer: "Wildcats" }]);
  assert.match(read("components/live/tenant-records.tsx"), /leadAnswers\(lead\)\.map/);
  assert.match(read("components/projects/project-thread.tsx"), /entry\.answers\?\.length/);
});

test("the server, the command and the page all read the studio's form", () => {
  const intake = read("functions/src/crm/public-lead.ts");
  assert.match(intake, /leadCaptureSettings\/\$\{tenantId\}`\)\.get\(\)/);
  assert.match(intake, /const prepared = prepareInquiryInput\(body, formConfig\);/);
  assert.match(intake, /inquiryRequirementIssues\(/);
  assert.match(intake, /customAnswers,\n/);
  assert.match(intake, /eventKind: chosenType\?\.kind \?\? null/);
  const commands = read("functions/src/crm/commands.ts");
  const branch = commands.slice(commands.indexOf('command.type === "setInquiryForm"'));
  assert.match(branch.slice(0, 600), /\["studio_owner", "studio_admin"\]\.includes\(membershipData\.role\)/);
  assert.match(branch, /validateInquiryFormConfig\(command\.input\.config\)/);
  const page = read("app/inquiry/page.tsx");
  assert.match(page, /normaliseInquiryFormConfig\(settings\?\.get\("inquiryForm"\)\)/);
  assert.match(page, /config=\{tenant\.form\}/);
  // The AI sees the answers when it reads the inquiry.
  assert.match(read("functions/src/operations/ai-pdf.ts"), /customAnswers:Array\.isArray\(lead\.get\("customAnswers"\)\)/);
  assert.match(read("functions/src/ai/message-draft.ts"), /answers: Array\.isArray\(lead\.get\("customAnswers"\)\)/);
});

test("a non-wedding inquiry's link asks only what its type asks", async () => {
  const { detailsAskedFor } = await import("../functions/src/booking/public-scheduling");
  const all = ["eventDate", "partnerName", "venue", "city", "ceremonyTime", "estimatedGuestCount", "phone"] as const;
  const sports = { city: "optional", venue: false, guests: false };
  assert.deepEqual(detailsAskedFor([...all], "sports", sports), ["eventDate", "city", "phone"]);
  assert.deepEqual(detailsAskedFor([...all], "wedding", sports), [...all]);
  // An inquiry from before the studio had types reads as before.
  assert.deepEqual(detailsAskedFor([...all], null, sports), [...all]);
  assert.deepEqual(
    detailsAskedFor([...all], "corporate", { city: "hidden", venue: true, guests: true }),
    ["eventDate", "venue", "estimatedGuestCount", "phone"],
  );
});
