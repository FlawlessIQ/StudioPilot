/**
 * Matching the person, package or form the operator actually named.
 *
 * Cue's flows carried only a type and a project, so "add albert gershengoren as
 * second photographer for erin and joe demattia" opened a generic picker with
 * no sign of Albert in it. He asked three times in six minutes. The words are
 * right there in the question and the record is right there on the roster;
 * nothing joined them.
 *
 * The model passes the operator's own words through as `flow.subject`. It never
 * emits an identifier — it has no roster tool, so any id would be invention —
 * and this matcher does the joining against records the client already holds.
 *
 * ## Why this is deliberately strict
 *
 * A wrong match offers a wedding to the wrong person, at a fee, by email. That
 * is worse in every case than asking. So: normalise, then accept an exact match
 * or a full token subset, and nothing else. No edit distance, no "closest"
 * scoring, no single-token surname guessing — "Albert" against two Alberts is
 * ambiguous and stays ambiguous.
 *
 * Pure and deterministic. Used by every copilot flow, so one rule governs crew,
 * packages and questionnaires alike.
 */

export type SubjectMatch =
  | { kind: "matched"; id: string; name: string }
  /** Several records fit the words. The operator picks; nothing is guessed. */
  | { kind: "ambiguous"; ids: string[] }
  /** Named something that is not there — worth saying, not silently ignoring. */
  | { kind: "unmatched" }
  /** Nothing was named; the flow behaves exactly as it always has. */
  | { kind: "none" };

/**
 * Case, accents, punctuation and doubled spaces removed.
 *
 * Studios type "O'Brien", "obrien" and "O Brien" for the same person, and an
 * imported roster carries whatever the spreadsheet had.
 */
export function normaliseSubject(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const tokens = (value: string): string[] =>
  normaliseSubject(value).split(" ").filter(Boolean);

/**
 * Whether every word the operator used appears in the candidate's name.
 *
 * "albert gershengoren" matches "Albert Gershengoren"; "gold cinematic" matches
 * "Gold Cinematic Package", which is how people refer to their own packages.
 * The reverse is not true — a candidate whose name is a subset of the words
 * typed is not a match, or "Albert" would match every Albert-ish record.
 */
function allWordsPresent(subject: string[], candidate: string[]): boolean {
  if (!subject.length) return false;
  const available = new Set(candidate);
  return subject.every((word) => available.has(word));
}

export function matchSubject(
  subject: string | null | undefined,
  candidates: readonly { id: string; name: string }[],
): SubjectMatch {
  const wanted = typeof subject === "string" ? normaliseSubject(subject) : "";
  if (!wanted) return { kind: "none" };

  const usable = candidates.filter((candidate) => candidate.id && candidate.name);
  const exact = usable.filter(
    (candidate) => normaliseSubject(candidate.name) === wanted,
  );
  const pool = exact.length
    ? exact
    : usable.filter((candidate) =>
        allWordsPresent(tokens(wanted), tokens(candidate.name)),
      );

  if (pool.length === 1)
    return { kind: "matched", id: pool[0]!.id, name: pool[0]!.name };
  if (pool.length > 1)
    return { kind: "ambiguous", ids: pool.map((candidate) => candidate.id) };
  return { kind: "unmatched" };
}

/**
 * What to say when the operator named something that is not on file.
 *
 * Said plainly, with the place to fix it — this is the answer the reference
 * studio should have had the first time, instead of a picker that could not
 * contain the person he asked for.
 */
export function unmatchedSubjectNotice(
  subject: string,
  kind: "crew" | "package" | "questionnaire",
): string {
  const where = {
    crew: "isn't in your crew list. Add them under People, or choose someone below.",
    package: "isn't one of your packages. Add it under Library, or choose one below.",
    questionnaire:
      "isn't one of your forms. Add it under Library, or choose one below.",
  }[kind];
  return `${subject.trim()} ${where}`;
}
