/**
 * The studio's own inquiry form: what it asks, and of whom.
 *
 * GR Productions, 2026-10-01: the inquiry form is the studio's main website
 * contact form, and it asked everyone about a wedding. "If Lynn is contacting
 * me about cheer pics, she doesn't need guests, venue, etc." So the studio
 * now writes its own list of event types (Wedding, Portraits, Sports…), and
 * each type says which "your day" fields the couple sees and whether the date
 * is required. A "general" type skips that step altogether. The budget and
 * "how did you hear about us" questions can be turned off, the studio can add
 * up to eight questions of its own, and it picks the button colour and
 * background.
 *
 * Stored on leadCaptureSettings/{tenantId}.inquiryForm, written only by the
 * crm command `setInquiryForm` (owner or admin), read server-side by the
 * public page (app/inquiry/page.tsx) and by publicLeadIntake.
 *
 * The one rule this file exists to keep: the server accepts exactly what the
 * page showed. `prepareInquiryInput` drops every value the chosen type hides
 * before anything is validated, so a field the couple never saw can neither
 * be required nor refused, and `inquiryRequirementIssues` asks only for what
 * the type marks required. The browser check (public-intake-validate.ts), the
 * schema (schema.ts) and the server (functions/src/crm/public-lead.ts) all run
 * these same two functions.
 *
 * functions/src/intake/inquiry-form-config.ts mirrors everything below the
 * marker; tests/inquiry-form-config.test.ts compares the two. No imports, so
 * the mirror needs none either.
 */
// ── mirrored below ──

/** What kind of event a studio's type is. "wedding" keeps the wedding-only behaviour (the event form). */
export const INQUIRY_EVENT_KINDS = ["wedding", "portraits", "sports", "corporate", "other", "general"] as const;
export type InquiryEventKind = (typeof INQUIRY_EVENT_KINDS)[number];

export const INQUIRY_FIELD_MODES = ["required", "optional", "hidden"] as const;
export type InquiryFieldMode = (typeof INQUIRY_FIELD_MODES)[number];

export const INQUIRY_QUESTION_TYPES = ["short_text", "long_text", "choice", "yes_no"] as const;
export type InquiryQuestionType = (typeof INQUIRY_QUESTION_TYPES)[number];

export const INQUIRY_BACKGROUNDS = ["cream", "white", "light"] as const;
export type InquiryBackground = (typeof INQUIRY_BACKGROUNDS)[number];

/** The "your day" fields a type can show. COI is only ever asked once a venue is chosen. */
export type InquiryDayFields = {
  eventDate: InquiryFieldMode;
  city: InquiryFieldMode;
  venue: boolean;
  guests: boolean;
  coi: boolean;
};

export type InquiryEventType = InquiryDayFields & {
  /** Stable, so a renamed type keeps its questions. */
  id: string;
  /** What the couple taps, and what the inquiry is stored as (`eventTypeLabel`). */
  label: string;
  kind: InquiryEventKind;
};

export type InquiryQuestion = {
  id: string;
  label: string;
  type: InquiryQuestionType;
  /** Only for `choice`. */
  options: string[];
  required: boolean;
  /** Which types it is asked for; empty means every type. */
  eventTypeIds: string[];
};

export type InquiryFormConfig = {
  eventTypes: InquiryEventType[];
  askBudget: boolean;
  askReferral: boolean;
  questions: InquiryQuestion[];
  /** The button and accent colour, `#RRGGBB`; null uses the studio's brand colour. */
  buttonColor: string | null;
  background: InquiryBackground;
};

export const INQUIRY_FORM_LIMITS = {
  eventTypes: 12,
  questions: 8,
  options: 12,
  typeLabel: 40,
  questionLabel: 200,
  option: 80,
  shortAnswer: 200,
  longAnswer: 2000,
} as const;

/** The same words wherever the check runs: browser, schema and server. */
export const INQUIRY_CONFIG_MESSAGES = {
  eventDate: "Pick the date of your event.",
  city: "Which city or town is the event in?",
  eventType: "Choose what you’re getting in touch about.",
  answer: "Answer this question — it helps the studio reply.",
  choice: "Choose one of the answers.",
  tooLong: (max: number) => `Keep this under ${max} characters.`,
} as const;

/** Each kind's sensible "your day" fields, used for new types and the defaults. */
export function dayFieldsForKind(kind: InquiryEventKind): InquiryDayFields {
  switch (kind) {
    case "wedding":
    case "corporate":
      return { eventDate: "required", city: "required", venue: true, guests: true, coi: true };
    case "portraits":
    case "sports":
      return { eventDate: "optional", city: "optional", venue: false, guests: false, coi: false };
    case "other":
      return { eventDate: "optional", city: "optional", venue: true, guests: false, coi: false };
    case "general":
      return { eventDate: "hidden", city: "hidden", venue: false, guests: false, coi: false };
  }
}

/**
 * What an inquiry that names no studio type is asked: the form as it was
 * before types existed — date and city required, everything else offered.
 * A page loaded before this shipped still posts that shape.
 */
export const LEGACY_DAY_FIELDS: InquiryDayFields = dayFieldsForKind("wedding");

function defaultType(id: string, label: string, kind: InquiryEventKind): InquiryEventType {
  return { id, label, kind, ...dayFieldsForKind(kind) };
}

export function defaultInquiryFormConfig(): InquiryFormConfig {
  return {
    eventTypes: [
      defaultType("wedding", "Wedding", "wedding"),
      defaultType("portraits", "Portraits", "portraits"),
      defaultType("sports", "Sports", "sports"),
      defaultType("corporate", "Corporate", "corporate"),
      defaultType("other", "Other", "other"),
      defaultType("general", "General question", "general"),
    ],
    // Referral stays on: every studio's form asked it before this existed.
    // Budget is off unless a studio turns it on — a price question on first
    // contact puts couples off before the studio has said a word (Conor,
    // 2026-10-02). No studio had saved a form yet, so none had chosen it.
    askBudget: false,
    askReferral: true,
    questions: [],
    buttonColor: null,
    background: "cream",
  };
}

/**
 * A new studio's inquiry form, by its trade (features/trades/trades.ts). A
 * DJ is asked about weddings, corporate events and parties, how many hours of
 * music, and whether the ceremony is theirs too — the first things a DJ
 * prices on (docs/vendor-journeys.md). Every other trade starts on the
 * default.
 */
export function defaultInquiryFormFor(trade: string | null | undefined): InquiryFormConfig {
  const base = defaultInquiryFormConfig();
  if (trade !== "dj") return base;
  return {
    ...base,
    eventTypes: [
      defaultType("wedding", "Wedding", "wedding"),
      defaultType("corporate", "Corporate event", "corporate"),
      defaultType("party", "Party", "other"),
      defaultType("general", "General question", "general"),
    ],
    questions: [
      {
        id: "music-hours",
        label: "How many hours of music would you like?",
        type: "choice",
        options: ["4 hours", "5 hours", "6 hours", "7 hours or more", "Not sure yet"],
        required: false,
        eventTypeIds: [],
      },
      {
        id: "ceremony-music",
        label: "Would you like us to play your ceremony too?",
        type: "yes_no",
        options: [],
        required: false,
        eventTypeIds: ["wedding"],
      },
    ],
  };
}

const TYPE_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const QUESTION_ID = /^[a-z0-9][a-z0-9_-]{0,59}$/;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const clean = (value: unknown): string => (typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "");
const oneOf = <T extends string>(choices: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (choices as readonly string[]).includes(value);

/** `#abc` → `#AABBCC`; anything else → null. */
export function normaliseHexColor(value: unknown): string | null {
  if (typeof value !== "string" || !HEX.test(value.trim())) return null;
  const hex = value.trim().slice(1);
  const full = hex.length === 3 ? hex.split("").map((digit) => digit + digit).join("") : hex;
  return `#${full.toUpperCase()}`;
}

/** An id for a new type or question from its label, unique among `taken`. */
export function inquiryIdFor(label: string, taken: readonly string[], fallback = "item"): string {
  const base =
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30) || fallback;
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}_${n}`;
  return id;
}

/**
 * Whether a type asks nothing about the day, so the "your day" step is
 * skipped and the couple goes straight from their details to the message.
 */
export function inquirySkipsDetails(type: InquiryDayFields | null): boolean {
  if (!type) return false;
  return type.eventDate === "hidden" && type.city === "hidden" && !type.venue && !type.guests;
}

type Checked = { config: InquiryFormConfig; errors: string[] };

/**
 * Read a stored or submitted config. `strict` lists every problem in the
 * studio's words (the command refuses on any); otherwise a bad piece is
 * dropped and the rest kept, so a page never fails to load over one.
 */
function readConfig(raw: unknown, strict: boolean): Checked {
  const errors: string[] = [];
  const defaults = defaultInquiryFormConfig();
  if (!isRecord(raw)) {
    if (strict) errors.push("The form settings are missing.");
    return { config: defaults, errors };
  }

  const types: InquiryEventType[] = [];
  const rawTypes = Array.isArray(raw.eventTypes) ? raw.eventTypes : [];
  if (strict && rawTypes.length === 0) errors.push("Add at least one type of inquiry.");
  for (const [index, entry] of rawTypes.entries()) {
    const where = `Type ${index + 1}`;
    if (!isRecord(entry)) {
      if (strict) errors.push(`${where} is not readable.`);
      continue;
    }
    const label = clean(entry.label);
    const id = clean(entry.id).toLowerCase();
    const kind = oneOf(INQUIRY_EVENT_KINDS, entry.kind) ? entry.kind : null;
    const problems: string[] = [];
    if (label.length < 2 || label.length > INQUIRY_FORM_LIMITS.typeLabel)
      problems.push(`${where} needs a name of 2 to ${INQUIRY_FORM_LIMITS.typeLabel} characters.`);
    if (!TYPE_ID.test(id)) problems.push(`${where} has no usable id.`);
    if (!kind) problems.push(`${label || where} needs a kind.`);
    if (types.some((type) => type.id === id)) problems.push(`${label || where} is listed twice.`);
    if (types.some((type) => type.label.toLowerCase() === label.toLowerCase()))
      problems.push(`Two types are called “${label}”. Give each its own name.`);
    const fallback = dayFieldsForKind(kind ?? "other");
    const mode = (field: "eventDate" | "city"): InquiryFieldMode => {
      if (oneOf(INQUIRY_FIELD_MODES, entry[field])) return entry[field];
      if (strict && entry[field] !== undefined) problems.push(`${label || where}: choose whether to ask for the ${field === "city" ? "city" : "date"}.`);
      return fallback[field];
    };
    const flag = (field: "venue" | "guests" | "coi"): boolean =>
      typeof entry[field] === "boolean" ? (entry[field] as boolean) : fallback[field];
    const fields: InquiryDayFields =
      kind === "general"
        ? dayFieldsForKind("general")
        : { eventDate: mode("eventDate"), city: mode("city"), venue: flag("venue"), guests: flag("guests"), coi: flag("coi") };
    // A certificate is a venue's question: no venue, no COI.
    if (!fields.venue) fields.coi = false;
    if (problems.length) {
      if (strict) errors.push(...problems);
      continue;
    }
    types.push({ id, label, kind: kind!, ...fields });
  }
  if (types.length > INQUIRY_FORM_LIMITS.eventTypes) {
    if (strict) errors.push(`Keep it to ${INQUIRY_FORM_LIMITS.eventTypes} types or fewer.`);
    types.length = INQUIRY_FORM_LIMITS.eventTypes;
  }
  // Nothing usable stored: the defaults, so the page still has types to offer.
  const eventTypes = types.length || strict ? types : defaults.eventTypes;
  const typeIds = new Set(eventTypes.map((type) => type.id));

  const questions: InquiryQuestion[] = [];
  const rawQuestions = Array.isArray(raw.questions) ? raw.questions : [];
  for (const [index, entry] of rawQuestions.entries()) {
    const where = `Question ${index + 1}`;
    if (!isRecord(entry)) {
      if (strict) errors.push(`${where} is not readable.`);
      continue;
    }
    const label = clean(entry.label);
    const id = clean(entry.id).toLowerCase();
    const type = oneOf(INQUIRY_QUESTION_TYPES, entry.type) ? entry.type : null;
    const problems: string[] = [];
    if (label.length < 3 || label.length > INQUIRY_FORM_LIMITS.questionLabel)
      problems.push(`${where} needs wording of 3 to ${INQUIRY_FORM_LIMITS.questionLabel} characters.`);
    if (!QUESTION_ID.test(id)) problems.push(`${where} has no usable id.`);
    if (questions.some((question) => question.id === id)) problems.push(`${label || where} is listed twice.`);
    if (!type) problems.push(`${label || where} needs an answer type.`);
    let options: string[] = [];
    if (type === "choice") {
      const given = Array.isArray(entry.options) ? entry.options.map(clean).filter(Boolean) : [];
      options = [...new Set(given)];
      if (options.length < 2) problems.push(`${label || where} needs at least two answers to choose from.`);
      if (options.length > INQUIRY_FORM_LIMITS.options)
        problems.push(`${label || where} can offer up to ${INQUIRY_FORM_LIMITS.options} answers.`);
      if (options.some((option) => option.length > INQUIRY_FORM_LIMITS.option))
        problems.push(`${label || where}: keep each answer under ${INQUIRY_FORM_LIMITS.option} characters.`);
    }
    const askedFor = Array.isArray(entry.eventTypeIds) ? entry.eventTypeIds.map(clean) : [];
    const unknown = askedFor.filter((typeId) => !typeIds.has(typeId));
    // A type removed in the same save is dropped quietly; it is not the studio's mistake.
    const eventTypeIds = [...new Set(askedFor.filter((typeId) => typeIds.has(typeId)))];
    if (askedFor.length && !eventTypeIds.length && unknown.length)
      problems.push(`${label || where} is only asked for types that no longer exist. Choose a type, or ask everyone.`);
    if (problems.length) {
      if (strict) errors.push(...problems);
      continue;
    }
    questions.push({
      id,
      label,
      type: type!,
      options,
      required: entry.required === true,
      eventTypeIds,
    });
  }
  if (questions.length > INQUIRY_FORM_LIMITS.questions) {
    if (strict) errors.push(`Keep it to ${INQUIRY_FORM_LIMITS.questions} questions or fewer.`);
    questions.length = INQUIRY_FORM_LIMITS.questions;
  }

  const buttonColor = raw.buttonColor === null || raw.buttonColor === undefined || raw.buttonColor === "" ? null : normaliseHexColor(raw.buttonColor);
  if (strict && buttonColor === null && raw.buttonColor !== null && raw.buttonColor !== undefined && raw.buttonColor !== "")
    errors.push("The button color must be a hex color such as #8A6A3A.");
  const background = oneOf(INQUIRY_BACKGROUNDS, raw.background) ? raw.background : defaults.background;
  if (strict && raw.background !== undefined && !oneOf(INQUIRY_BACKGROUNDS, raw.background))
    errors.push("Choose cream, white or light gray for the background.");

  return {
    config: {
      eventTypes,
      askBudget: typeof raw.askBudget === "boolean" ? raw.askBudget : defaults.askBudget,
      askReferral: typeof raw.askReferral === "boolean" ? raw.askReferral : defaults.askReferral,
      questions,
      buttonColor,
      background,
    },
    errors,
  };
}

/** A stored config as the page and the server use it: never throws, falls back piece by piece. */
export function normaliseInquiryFormConfig(raw: unknown): InquiryFormConfig {
  return readConfig(raw, false).config;
}

/** A config a studio is saving: every problem, in plain words, or the cleaned config. */
export function validateInquiryFormConfig(
  raw: unknown,
): { ok: true; config: InquiryFormConfig } | { ok: false; errors: string[] } {
  const { config, errors } = readConfig(raw, true);
  return errors.length ? { ok: false, errors } : { ok: true, config };
}

/**
 * The studio type an inquiry chose. By `eventTypeKey` when the page sent one;
 * otherwise by the old free-text `eventType` (an id or a label), which is all
 * a page loaded before types existed sends. A key that names no type is
 * `unknownKey`: the page was out of date, or tampered with.
 */
export function resolveInquiryEventType(
  config: InquiryFormConfig,
  input: { eventTypeKey?: unknown; eventType?: unknown },
): { type: InquiryEventType | null; unknownKey: boolean } {
  const key = clean(input.eventTypeKey).toLowerCase();
  if (key) {
    const type = config.eventTypes.find((candidate) => candidate.id === key) ?? null;
    return { type, unknownKey: !type };
  }
  const label = clean(input.eventType).toLowerCase();
  if (!label) return { type: null, unknownKey: false };
  const type =
    config.eventTypes.find((candidate) => candidate.id === label) ??
    config.eventTypes.find((candidate) => candidate.label.toLowerCase() === label) ??
    null;
  return { type, unknownKey: false };
}

/** The "your day" fields an inquiry of this type is asked; the old form's when no type is known. */
export function dayFieldsFor(type: InquiryEventType | null): InquiryDayFields {
  if (!type) return LEGACY_DAY_FIELDS;
  return { eventDate: type.eventDate, city: type.city, venue: type.venue, guests: type.guests, coi: type.venue && type.coi };
}

/** The studio's own questions this type is asked, in the studio's order. */
export function questionsForType(config: InquiryFormConfig, type: InquiryEventType | null): InquiryQuestion[] {
  return config.questions.filter(
    (question) => question.eventTypeIds.length === 0 || (type !== null && question.eventTypeIds.includes(type.id)),
  );
}

/**
 * The submitted values with everything this inquiry was not asked removed.
 *
 * Runs before any check, on the browser, in the schema and on the server, so
 * a venue typed before the couple switched to "General question" is neither
 * validated nor stored. A blank date or city is "not given" (a date box left
 * empty sends ""). Anything that is not an object is passed through for the
 * schema to refuse.
 */
export function prepareInquiryInput(raw: unknown, config: InquiryFormConfig): unknown {
  if (!isRecord(raw)) return raw;
  const out: Record<string, unknown> = { ...raw };
  const { type } = resolveInquiryEventType(config, raw);
  const fields = dayFieldsFor(type);
  const blank = (value: unknown) => value === undefined || (typeof value === "string" && !value.trim());
  if (typeof out.eventTypeKey === "string" && !out.eventTypeKey.trim()) out.eventTypeKey = null;
  if (fields.eventDate === "hidden" || blank(out.eventDate)) out.eventDate = null;
  if (fields.city === "hidden" || blank(out.city)) out.city = null;
  if (!fields.venue) {
    out.venue = null;
    out.venuePlace = null;
  }
  if (!fields.coi) {
    out.coiRequired = null;
    out.venueContactName = null;
    out.venueContactEmail = null;
  }
  if (!fields.guests) out.estimatedGuestCount = null;
  if (!config.askBudget) out.budgetRange = null;
  if (!config.askReferral) out.referralSource = null;
  if (out.customAnswers === undefined || out.customAnswers === null) out.customAnswers = {};
  else if (isRecord(out.customAnswers)) {
    const asked = new Set(questionsForType(config, type).map((question) => question.id));
    const answers: Record<string, unknown> = {};
    for (const [id, answer] of Object.entries(out.customAnswers)) {
      if (!asked.has(id)) continue;
      // An empty answer is no answer; anything else, even malformed, is kept
      // for the schema to judge.
      if (typeof answer === "string" && !answer.trim()) continue;
      answers[id] = answer;
    }
    out.customAnswers = answers;
  }
  return out;
}

export type InquiryIssue = { path: string[]; message: string };

/**
 * What this inquiry's type requires that is missing, and answers that are not
 * among the choices offered. Called on prepared values (see above). A value
 * that is present but malformed is the schema's to refuse, never reported
 * twice here.
 */
export function inquiryRequirementIssues(values: unknown, config: InquiryFormConfig): InquiryIssue[] {
  if (!isRecord(values)) return [];
  const issues: InquiryIssue[] = [];
  const { type, unknownKey } = resolveInquiryEventType(config, values);
  if (unknownKey) issues.push({ path: ["eventTypeKey"], message: INQUIRY_CONFIG_MESSAGES.eventType });
  const fields = dayFieldsFor(type);
  if (fields.eventDate === "required" && (values.eventDate === null || values.eventDate === undefined))
    issues.push({ path: ["eventDate"], message: INQUIRY_CONFIG_MESSAGES.eventDate });
  if (fields.city === "required" && (values.city === null || values.city === undefined))
    issues.push({ path: ["city"], message: INQUIRY_CONFIG_MESSAGES.city });
  const answers = isRecord(values.customAnswers) ? values.customAnswers : null;
  if (values.customAnswers !== undefined && values.customAnswers !== null && !answers) return issues;
  for (const question of questionsForType(config, type)) {
    const raw = answers?.[question.id];
    if (raw !== undefined && typeof raw !== "string") continue;
    const answer = typeof raw === "string" ? raw.trim() : "";
    const path = ["customAnswers", question.id];
    if (!answer) {
      if (question.required) issues.push({ path, message: INQUIRY_CONFIG_MESSAGES.answer });
      continue;
    }
    if (question.type === "choice" && !question.options.includes(answer))
      issues.push({ path, message: INQUIRY_CONFIG_MESSAGES.choice });
    else if (question.type === "yes_no" && answer !== "yes" && answer !== "no")
      issues.push({ path, message: INQUIRY_CONFIG_MESSAGES.choice });
    else if (question.type === "short_text" && answer.length > INQUIRY_FORM_LIMITS.shortAnswer)
      issues.push({ path, message: INQUIRY_CONFIG_MESSAGES.tooLong(INQUIRY_FORM_LIMITS.shortAnswer) });
  }
  return issues;
}

/**
 * The answers as they are kept on the inquiry: the question's wording at the
 * time it was asked, so a later edit to the form never changes what a couple
 * said. Yes/no reads as "Yes"/"No".
 */
export function inquiryAnswersForLead(
  config: InquiryFormConfig,
  type: InquiryEventType | null,
  answers: Record<string, string> | null | undefined,
): Array<{ questionId: string; question: string; answer: string }> {
  const out: Array<{ questionId: string; question: string; answer: string }> = [];
  for (const question of questionsForType(config, type)) {
    const answer = (answers?.[question.id] ?? "").trim();
    if (!answer) continue;
    out.push({
      questionId: question.id,
      question: question.label,
      answer: question.type === "yes_no" ? (answer === "yes" ? "Yes" : "No") : answer,
    });
  }
  return out;
}
