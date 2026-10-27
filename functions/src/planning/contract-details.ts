import { normalisedQuestion, valueForField } from "./job-facts.js";
import { VENDOR_SECTION_FIELD_ID } from "./vendor-section.js";

/**
 * What a signed contract says about the day, for a job imported from before
 * StudioCue (GR Productions, 2026-10-27).
 *
 * Gabe imported his book from a spreadsheet and opened a couple's Final
 * schedule: the date and the venue, and nothing else — names, prep
 * locations, ceremony and reception times, all in the contract on his disk,
 * all "Not answered yet". "People are not gonna want to have their clients
 * redo all this."
 *
 * So a contract is read against the studio's own questions (the forms it
 * sends), the studio checks what was read, and the answers it approves are
 * kept on the job (`projects.contractDetails`). From there they reach every
 * place the couple's answers do, without being one of the couple's forms:
 *
 *   - every form on the job, now and later, prefills from them by question
 *     (job-facts.ts, as the same question answered on an earlier form);
 *   - Schedule A prints them for any question no returned form has answered
 *     (contracts/sources.ts).
 *
 * The couple can still change any of it: a prefill is a starting point, and
 * what a person types outranks it everywhere (planning/resolved-answers.ts).
 *
 * Pure. The reading itself is ai/contract-details.ts; the write is
 * imports/commands.ts `applyContractDetails`.
 */

type Row = Record<string, unknown>;
const record = (value: unknown): Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** One answer the studio approved, kept on the job. */
export type ContractDetailRow = {
  /** The question, normalised: the same question on two forms reads the same. */
  key: string;
  /** The question as the studio's form words it. */
  label: string;
  /** The form field's type, so a time goes into a time field. */
  type: string;
  value: string;
  /** The form section it came from, for reading the list back. */
  section?: string;
};

/** One of the studio's questions, as the reader is asked it. */
export type ContractQuestion = {
  /** "q1", "q2": what the reader answers by. */
  id: string;
  key: string;
  label: string;
  type: string;
  options: string[];
  section: string;
};

/** Field types an answer read off a page can go into. Files, signatures and lists can't. */
const READABLE = new Set(["text", "long_text", "email", "phone", "date", "time", "address", "dropdown", "radio", ""]);

/** The most questions one reading is asked: a long Final schedule is about 60. */
export const MAX_CONTRACT_QUESTIONS = 120;

/**
 * The studio's questions a contract could answer, from its forms: the forms
 * on the job first (their wording is what the couple sees), then the rest of
 * the studio's. Each question once, by its wording.
 */
export function contractQuestions(forms: ReadonlyArray<{ sections: unknown }>): ContractQuestion[] {
  const questions: ContractQuestion[] = [];
  const seen = new Set<string>();
  for (const form of forms) {
    for (const candidate of list(form.sections)) {
      const section = record(candidate);
      for (const value of list(section.fields)) {
        const field = record(value);
        const type = text(field.type);
        const label = text(field.label);
        const key = normalisedQuestion(label);
        if (!label || !key || seen.has(key)) continue;
        if (field.internalOnly === true || field.locked === true || text(field.id) === VENDOR_SECTION_FIELD_ID) continue;
        if (!READABLE.has(type)) continue;
        seen.add(key);
        questions.push({
          id: `q${questions.length + 1}`,
          key,
          label: label.slice(0, 300),
          type,
          options: list(field.options).map(text).filter(Boolean).slice(0, 30),
          section: text(section.title).slice(0, 120),
        });
        if (questions.length >= MAX_CONTRACT_QUESTIONS) return questions;
      }
    }
  }
  return questions;
}

/**
 * What the reader answered, as rows a form can take: each shaped for its
 * question's type (a date as YYYY-MM-DD, a time as HH:MM, a choice only one
 * of its own options), and dropped when it doesn't fit — a blank the studio
 * can fill beats a wrong answer the couple has to notice.
 */
export function contractRowsFromAnswers(
  questions: ReadonlyArray<ContractQuestion>,
  answers: ReadonlyArray<{ id: string; answer: string }>,
): ContractDetailRow[] {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const rows: ContractDetailRow[] = [];
  const done = new Set<string>();
  for (const answer of answers) {
    const question = byId.get(answer.id);
    const said = answer.answer.trim();
    if (!question || !said || done.has(question.key)) continue;
    const value = valueForField({ type: question.type, options: question.options }, said);
    if (!value) continue;
    done.add(question.key);
    rows.push({ key: question.key, label: question.label, type: question.type, value: value.slice(0, 2000), section: question.section });
  }
  return rows;
}

/** Rows as stored on a project, whatever shape the record is in. */
export function contractDetailRows(value: unknown): ContractDetailRow[] {
  return list(value)
    .map(record)
    .map((row) => ({
      key: normalisedQuestion(text(row.key) || text(row.label)),
      label: text(row.label),
      type: text(row.type),
      value: text(row.value),
      section: text(row.section) || undefined,
    }))
    .filter((row) => row.key && row.label && row.value);
}

/**
 * A later contract reading on top of an earlier one: the newer answer to a
 * question wins, and a question the studio unticked (`drop`, as worded) is
 * taken out — kept from an earlier reading, it would otherwise come back.
 */
export function mergeContractRows(
  prior: ReadonlyArray<ContractDetailRow>,
  incoming: ReadonlyArray<ContractDetailRow>,
  drop: ReadonlyArray<string> = [],
): ContractDetailRow[] {
  const merged = new Map<string, ContractDetailRow>();
  for (const row of prior) merged.set(row.key, row);
  for (const row of incoming) merged.set(row.key, row);
  for (const label of drop) merged.delete(normalisedQuestion(label));
  return [...merged.values()].slice(0, MAX_CONTRACT_QUESTIONS);
}

/** "16:30" → "4:30 PM", for printing. */
function spoken(value: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}

/**
 * Schedule A's rows from the contract, for questions no returned form has
 * answered. `answered` holds the questions already printed, lower-cased as
 * contracts/sources.ts keys them: the couple's answer always wins.
 */
export function scheduleAContractAnswers(
  rows: ReadonlyArray<ContractDetailRow>,
  answered: ReadonlySet<string>,
): Array<{ key: string; question: string; answer: string }> {
  return rows
    .filter((row) => !answered.has(row.label.trim().toLowerCase()))
    .map((row) => ({ key: row.label.trim().toLowerCase(), question: row.label, answer: row.type === "time" ? spoken(row.value) : row.value }));
}

/** The words a name is made of, for matching "Erin Hoffman" to "Hoffman & DeMattia". */
function nameWords(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 3 && !["and", "the", "wedding", "mitzvah"].includes(word));
}

export type ContractJobCandidate = {
  projectId: string;
  name: string;
  eventDate: string | null;
  clientNames: string[];
};

/**
 * Which job a contract is for: one on the contract's date whose clients share
 * a surname with the people it names. Null when that isn't exactly one job —
 * the studio picks, rather than StudioCue guessing a couple's wedding.
 */
export function matchContractToJob(
  reading: { clientNames: ReadonlyArray<string>; eventDate: string | null },
  candidates: ReadonlyArray<ContractJobCandidate>,
): ContractJobCandidate | null {
  if (!reading.eventDate) return null;
  const read = new Set(reading.clientNames.flatMap(nameWords));
  if (!read.size) return null;
  const matching = candidates.filter(
    (candidate) =>
      candidate.eventDate === reading.eventDate &&
      [candidate.name, ...candidate.clientNames].flatMap(nameWords).some((word) => read.has(word)),
  );
  return matching.length === 1 ? matching[0]! : null;
}
