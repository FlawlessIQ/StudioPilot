/**
 * One answer per question across a job's forms: the single source of truth for
 * what the couple (or the studio) has said.
 *
 * GR Productions (2026-10-13): "a lot of the fields that have already been
 * captured in previous documents and questionnaires are showing up as TBD in
 * future parts of the journey." Every reader picked its own source — the one
 * form it was looking at, the newest form, the form edited last, a merge by
 * question wording — and none of them knew that "TBD" means "not decided yet"
 * (field-extras.ts). So an Event details form answered "TBD" at the inquiry
 * kept saying TBD in the review, the run of show, the crew sheet, Schedule A,
 * the lock-day sign-off and Cue, long after the Final schedule settled it.
 *
 * The rule, everywhere:
 * - **A question is the same question across forms** when it has the same
 *   field id *and* the same wording (the recommended Event details and Final
 *   schedule share both), or the same specific wording once case and
 *   punctuation are set aside. A shared id alone isn't enough: built-in forms
 *   reuse "guest-count" for "Number of invited guests" and "Final guest count".
 * - **What a person typed beats what was prefilled.** A value prefilled from
 *   the job, an earlier answer or a suggested time that the couple sent on
 *   unchanged still counts — they kept it — but any answer a person typed
 *   outranks it, and it outranks a "TBD".
 * - **The newest real answer wins**, timed by when that field was answered
 *   (`answerProvenance.changedAt`), not when its form was sent or last
 *   touched — a studio fixing a typo on the old form must not bring its old
 *   answers back. At the same moment, the studio's answer beats the couple's.
 * - **"TBD" and blank never override a real answer.** A question is "tbd" only
 *   when nobody has given a real answer anywhere.
 * - Forms count while they are sent back (`submitted` or `locked`). One the
 *   couple is still filling in, has reopened to change, or withdrew doesn't:
 *   half-typed edits are not answers anyone stood behind.
 *
 * Pure and import-free, so functions/src/planning/resolved-answers.ts is a
 * byte-for-byte copy (tests/resolved-answers.test.ts fails on a drift).
 */

type Row = Record<string, unknown>;

export type ResolvableResponse = {
  id: string;
  status?: unknown;
  archivedAt?: unknown;
  templateName?: unknown;
  templateSnapshot?: unknown;
  answers?: unknown;
  answerProvenance?: unknown;
  submittedAt?: unknown;
  updatedAt?: unknown;
  createdAt?: unknown;
};

export type ResolvedAnswer = {
  /** The key every form's copy of this question shares (see `questionKey`). */
  key: string;
  /** The question as the form that gave the winning answer words it. */
  label: string;
  fieldId: string;
  type: string;
  /** "answered": a real answer. "tbd": only "not decided yet" so far. */
  status: "answered" | "tbd";
  value: unknown;
  responseId: string;
  formName: string;
  /** When that field was answered, as best the record says. */
  answeredAt: string;
  by: "client" | "studio";
  /** Prefilled and sent on unchanged, never typed by a person. */
  prefilled: boolean;
};

export type ResolvedAnswers = {
  /** Every question answered (or TBD) on any counted form, by key. */
  byKey: Map<string, ResolvedAnswer>;
  /** The key a form's field belongs to: `${responseId}:${fieldId}` → key. */
  keyOf: Map<string, string>;
};

const RETURNED = new Set(["submitted", "locked"]);
const PEOPLE = new Set(["client_answer", "studio_answer"]);

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const record = (value: unknown): Row => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** "Not decided yet" (field-extras.ts `isTbd`, repeated so this file has no imports). */
export function isTbdValue(value: unknown): boolean {
  return typeof value === "string" && /^\s*(tbd|tbc|to be (decided|determined|confirmed))\s*$/i.test(value);
}

/** Nothing said at all. */
export function isBlankValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** A question's wording with case, apostrophes and punctuation set aside (job-facts.ts `normalisedQuestion`). */
export function normalisedWording(value: unknown): string {
  return String(value ?? "")
    .toLocaleLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const GENERIC = new Set(["notes", "note", "comments", "comment", "other", "anything else", "questions", "details", "additional notes", "additional details", "special requests"]);

/**
 * The wording a question can be matched across forms by, or "" when it is too
 * general to be one question: "Notes" on the Event details and "Notes" on the
 * Shot list are two different things, and a long free-text box is the
 * couple's words for that form alone.
 */
export function matchableWording(field: { label: string; type: string }): string {
  if (field.type === "long_text") return "";
  const wording = normalisedWording(field.label);
  if (!wording || wording.split(" ").length < 2 || GENERIC.has(wording)) return "";
  return wording;
}

/** Whether a form's answers count: sent back and not reopened, withdrawn or archived. */
export function responseCounts(response: ResolvableResponse): boolean {
  if (response.archivedAt) return false;
  return RETURNED.has(text(response.status));
}

type Field = { id: string; label: string; type: string };

function fieldsOf(response: ResolvableResponse): Field[] {
  return list(record(response.templateSnapshot).sections).flatMap((section) =>
    list(record(section).fields)
      .map(record)
      .filter((field) => text(field.id) && field.internalOnly !== true && field.type !== "information")
      .map((field) => ({ id: text(field.id), label: text(field.label) || text(field.id), type: text(field.type) || "text" })),
  );
}

/**
 * Resolve every question across a job's forms. Deterministic: the same records
 * always give the same answers, whatever order they were read in.
 */
export function resolveAnswers(responses: readonly ResolvableResponse[]): ResolvedAnswers {
  const counted = responses.filter(responseCounts).sort((left, right) => left.id.localeCompare(right.id));
  // Questions are the same question by id or by wording: the first key either
  // was seen under is the one both share.
  const keyByIdAndWording = new Map<string, string>();
  const keyByWording = new Map<string, string>();
  const keyOf = new Map<string, string>();
  for (const response of counted) {
    for (const field of fieldsOf(response)) {
      const exact = `${field.id}|${normalisedWording(field.label)}`;
      const wording = matchableWording(field);
      const key = keyByIdAndWording.get(exact) ?? (wording ? keyByWording.get(wording) : undefined) ?? `field:${exact}`;
      if (!keyByIdAndWording.has(exact)) keyByIdAndWording.set(exact, key);
      if (wording && !keyByWording.has(wording)) keyByWording.set(wording, key);
      keyOf.set(`${response.id}:${field.id}`, key);
    }
  }

  type Candidate = ResolvedAnswer & { tbd: boolean };
  const candidates = new Map<string, Candidate[]>();
  for (const response of counted) {
    const answers = record(response.answers);
    const provenance = record(response.answerProvenance);
    const formTime = text(response.submittedAt) || text(response.updatedAt) || text(response.createdAt);
    for (const field of fieldsOf(response)) {
      const value = answers[field.id];
      if (isBlankValue(value)) continue;
      const origin = record(provenance[field.id]);
      const source = text(origin.sourceType);
      // A prefill the couple sent on unchanged: kept, but below anything typed.
      const prefilled = Boolean(source) && !PEOPLE.has(source);
      const key = keyOf.get(`${response.id}:${field.id}`)!;
      const entry: Candidate = {
        key,
        label: field.label,
        fieldId: field.id,
        type: field.type,
        status: isTbdValue(value) ? "tbd" : "answered",
        value,
        responseId: response.id,
        formName: text(response.templateName) || "Form",
        answeredAt: text(origin.changedAt) || formTime,
        by: source === "studio_answer" ? "studio" : "client",
        prefilled,
        tbd: isTbdValue(value),
      };
      candidates.set(key, [...(candidates.get(key) ?? []), entry]);
    }
  }

  const byKey = new Map<string, ResolvedAnswer>();
  for (const [key, entries] of candidates) {
    // Typed real answers, then kept prefills, then "TBD".
    const typed = entries.filter((entry) => !entry.tbd && !entry.prefilled);
    const kept = entries.filter((entry) => !entry.tbd && entry.prefilled);
    const pool = typed.length ? typed : kept.length ? kept : entries;
    const winner = [...pool].sort(
      (left, right) =>
        right.answeredAt.localeCompare(left.answeredAt) ||
        // The same moment: the studio's answer is the one that stands.
        Number(right.by === "studio") - Number(left.by === "studio") ||
        left.responseId.localeCompare(right.responseId),
    )[0]!;
    const { tbd: _tbd, ...resolved } = winner;
    void _tbd;
    byKey.set(key, resolved);
  }
  return { byKey, keyOf };
}

/** The resolved answer to one form's field (its own, or a newer real one from another form). */
export function resolvedFor(resolved: ResolvedAnswers, responseId: string, fieldId: string): ResolvedAnswer | null {
  const key = resolved.keyOf.get(`${responseId}:${fieldId}`);
  return key ? (resolved.byKey.get(key) ?? null) : null;
}

/** The better of two answers for one slot: real over "TBD", typed over prefilled, then the newer. */
function better(left: ResolvedAnswer, right: ResolvedAnswer): ResolvedAnswer {
  const rank = (answer: ResolvedAnswer) => (answer.status === "answered" ? 2 : 0) + (answer.prefilled ? 0 : 1);
  if (rank(left) !== rank(right)) return rank(left) > rank(right) ? left : right;
  return right.answeredAt > left.answeredAt ? right : left;
}

/**
 * One flat answers record for readers keyed by field id (the day plan, the
 * crew brief, the AI timeline): every question's resolved value under each
 * field id any form used for it. A TBD is kept only where nothing real exists.
 */
export function resolvedAnswerRecord(resolved: ResolvedAnswers): Record<string, unknown> {
  // Two questions can share a field id (they aren't one question); the slot
  // takes the better answer of the two.
  const best = new Map<string, ResolvedAnswer>();
  for (const [formField, key] of resolved.keyOf) {
    const answer = resolved.byKey.get(key);
    if (!answer) continue;
    const fieldId = formField.slice(formField.indexOf(":") + 1);
    const held = best.get(fieldId);
    best.set(fieldId, held ? better(held, answer) : answer);
  }
  return Object.fromEntries([...best].map(([fieldId, answer]) => [fieldId, answer.value]));
}

/** The resolved answers as rows a person reads, in the order the forms ask them. */
export function resolvedRows(resolved: ResolvedAnswers): ResolvedAnswer[] {
  const seen = new Set<string>();
  const rows: ResolvedAnswer[] = [];
  for (const key of resolved.keyOf.values()) {
    if (seen.has(key)) continue;
    seen.add(key);
    const answer = resolved.byKey.get(key);
    if (answer) rows.push(answer);
  }
  return rows;
}

export type FormFreshness = {
  /** Left blank or "TBD" on this form, answered since on another. */
  settled: Array<{ fieldId: string; label: string; value: unknown; formName: string; answeredAt: string }>;
  /** Still open: "TBD" or a required question left blank, with nothing real anywhere. */
  open: Array<{ fieldId: string; label: string }>;
};

/**
 * What a form left undecided, and what has been settled since — so a review,
 * a follow-up or a brief written from it can tell it is out of date. An
 * optional question left blank is not "open": the couple skipped it.
 */
export function formFreshness(resolved: ResolvedAnswers, response: ResolvableResponse): FormFreshness {
  const answers = record(response.answers);
  const required = new Set(
    list(record(response.templateSnapshot).sections).flatMap((section) =>
      list(record(section).fields)
        .map(record)
        .filter((field) => field.required === true)
        .map((field) => text(field.id)),
    ),
  );
  const out: FormFreshness = { settled: [], open: [] };
  for (const field of fieldsOf(response)) {
    const own = answers[field.id];
    const undecided = isTbdValue(own) || (isBlankValue(own) && required.has(field.id));
    if (!undecided) continue;
    const now = resolvedFor(resolved, response.id, field.id);
    if (now && now.status === "answered" && now.responseId !== response.id)
      out.settled.push({ fieldId: field.id, label: field.label, value: now.value, formName: now.formName, answeredAt: now.answeredAt });
    else out.open.push({ fieldId: field.id, label: field.label });
  }
  return out;
}

/**
 * A form's answers with every undecided one replaced by its settled answer
 * from another form: what a reader of that one form (its crew brief, its
 * review) should see now.
 */
export function answersAsSettled(resolved: ResolvedAnswers, response: ResolvableResponse): Record<string, unknown> | unknown[] {
  // An imported form's answers as question/answer rows have no fields to settle.
  if (Array.isArray(response.answers)) return response.answers;
  const out: Record<string, unknown> = { ...record(response.answers) };
  for (const item of formFreshness(resolved, response).settled) out[item.fieldId] = item.value;
  return out;
}

/**
 * Everything the couple has told the studio, as one record keyed by field id,
 * for readers that lay out the day from it (the day plan, the AI timeline).
 * The resolved answers first; then, for questions nothing sent back answers,
 * what a form still being filled in says, or a key outside any form's
 * template — so the studio can start the day before the final schedule comes
 * back. A "TBD" never covers a real answer, wherever it sits.
 */
export function jobAnswerRecord(responses: readonly ResolvableResponse[]): Record<string, unknown> {
  const out = resolvedAnswerRecord(resolveAnswers(responses));
  const live = responses
    .filter((response) => !response.archivedAt && text(response.status) !== "withdrawn" && text(response.status) !== "archived")
    // Newest form first: the first value a question finds is the newest.
    .sort((left, right) =>
      (text(right.updatedAt) || text(right.submittedAt)).localeCompare(text(left.updatedAt) || text(left.submittedAt)) ||
      left.id.localeCompare(right.id),
    );
  for (const response of live) {
    for (const [key, value] of Object.entries(record(response.answers))) {
      if (isBlankValue(value)) continue;
      const held = out[key];
      if (held !== undefined && !isTbdValue(held)) continue;
      if (held !== undefined && isTbdValue(value)) continue;
      out[key] = value;
    }
  }
  return out;
}

/**
 * A form's answers with every question it asks carrying the job's resolved
 * answer — the newest real one from any form — for readers that print a form's
 * questions (the lock-day sign-off, the agreement's Schedule A): the same
 * question shows the same answer on every form that asks it.
 */
export function answersResolvedFor(resolved: ResolvedAnswers, response: ResolvableResponse): Record<string, unknown> | unknown[] {
  // An imported form's answers as question/answer rows: printed as they were given.
  if (Array.isArray(response.answers)) return response.answers;
  const answers = record(response.answers);
  const out: Record<string, unknown> = { ...answers };
  for (const field of fieldsOf(response)) {
    const answer = resolvedFor(resolved, response.id, field.id);
    if (!answer) continue;
    // Never a "TBD" over something real this form holds.
    if (answer.status === "tbd" && !isBlankValue(answers[field.id]) && !isTbdValue(answers[field.id])) continue;
    out[field.id] = answer.value;
  }
  return out;
}

const PLAIN_WORDS = new Set(["time", "times", "start", "end", "the", "and", "your", "for", "of", "a", "an", "to", "in", "at", "on", "is", "are", "what", "when", "where"]);

/**
 * Whether a flag (a missing detail, a follow-up question) is about one of
 * these questions: every telling word of the question appears in it, a word
 * of three letters or more matching by its start ("prep" in "preparation").
 * Never used on contradictions or risks: those stand until a person clears them.
 */
export function flagMentions(item: string, labels: readonly string[]): boolean {
  const said = normalisedWording(item).split(" ").filter((word) => word.length >= 3 && !PLAIN_WORDS.has(word));
  return labels.some((label) => {
    const telling = normalisedWording(label).split(" ").filter((word) => word.length >= 3 && !PLAIN_WORDS.has(word));
    return telling.length > 0 && telling.every((word) => said.some((other) => other.startsWith(word) || word.startsWith(other)));
  });
}

/**
 * Whether a planning review written from this form is about nothing any more,
 * and its prepared follow-up should be withdrawn: it was written before the
 * answers that settled it, it raised no contradiction or risk (those stand
 * until a person clears them), and every missing detail it listed is one of
 * the questions settled since.
 */
export function reviewSettled(
  freshness: FormFreshness,
  review: { generatedAt?: unknown; missingInformation?: unknown; contradictions?: unknown; planningRisks?: unknown },
): boolean {
  if (!freshness.settled.length || freshness.open.length) return false;
  const strings = (value: unknown) => list(value).filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  if (strings(review.contradictions).length || strings(review.planningRisks).length) return false;
  const generatedAt = text(review.generatedAt);
  const newestSettling = freshness.settled.map((item) => item.answeredAt).sort().at(-1) ?? "";
  if (!generatedAt || !newestSettling || generatedAt >= newestSettling) return false;
  const labels = freshness.settled.map((item) => item.label);
  return strings(review.missingInformation).every((item) => flagMentions(item, labels));
}
