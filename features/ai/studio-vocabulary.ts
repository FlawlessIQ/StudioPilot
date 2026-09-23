import { normaliseSubject } from "@/features/ai/flow-subject";

/**
 * What this studio calls things, learned from what it types.
 *
 * Cue's matchers are deterministic and strict, which is right — a wrong match
 * emails a job offer to the wrong person. The cost is that they only know the
 * spellings in the records. The reference studio types "2nd photogrpaher",
 * shortens every couple to first names, and files jobs as "Erin Hoffman &
 * Joseph DeMattia" while asking about "erin and joe demattia". Three separate
 * fixes went into the project matcher this month chasing exactly that gap.
 *
 * An alias is only ever created by the operator resolving an ambiguity
 * themselves — they typed something, Cue could not place it, they said which
 * one they meant. That is a fact about this studio's language, not a guess,
 * and it is worth remembering.
 *
 * Scoped per tenant. One studio's "the Johnson job" is another's stranger.
 *
 * Pure: storage and the moment of capture live with the caller.
 */

export type StudioAlias = {
  /** What the operator typed, normalised. */
  said: string;
  /** The record they meant. */
  targetId: string;
  /** What kind of record, so a project alias cannot resolve a person. */
  kind: "project" | "crew" | "package";
  /** How many times this pairing has been confirmed. */
  timesConfirmed: number;
};

/**
 * An alias earns its place the second time.
 *
 * Once is a typo. Twice is how they talk — and the floor matters, because an
 * alias skips the matcher's own safeguards.
 */
export const ALIAS_CONFIRMATIONS_REQUIRED = 2;

export function aliasKey(said: string, kind: StudioAlias["kind"]): string {
  return `${kind}:${normaliseSubject(said)}`;
}

/**
 * The record this studio means by these words, if they have said so before.
 *
 * Returns null on anything under the floor, on an unknown phrase, and — the
 * case worth being careful about — when the same words have been resolved to
 * more than one record. A studio that has used "the Johnson job" for two
 * different weddings has told us the phrase is ambiguous, not that the newer
 * one wins.
 */
export function resolveAlias(
  said: string,
  kind: StudioAlias["kind"],
  aliases: readonly StudioAlias[],
): string | null {
  const wanted = normaliseSubject(said);
  if (!wanted) return null;
  const matches = aliases.filter(
    (alias) =>
      alias.kind === kind &&
      normaliseSubject(alias.said) === wanted &&
      alias.timesConfirmed >= ALIAS_CONFIRMATIONS_REQUIRED,
  );
  const targets = new Set(matches.map((alias) => alias.targetId));
  return targets.size === 1 ? (matches[0]?.targetId ?? null) : null;
}

/**
 * Record that the operator resolved these words to this record.
 *
 * Idempotent per pairing: confirming the same thing again strengthens it
 * rather than adding a row.
 */
export function confirmAlias(
  said: string,
  kind: StudioAlias["kind"],
  targetId: string,
  aliases: readonly StudioAlias[],
): StudioAlias[] {
  const wanted = normaliseSubject(said);
  if (!wanted || !targetId) return [...aliases];
  const existing = aliases.find(
    (alias) =>
      alias.kind === kind &&
      normaliseSubject(alias.said) === wanted &&
      alias.targetId === targetId,
  );
  if (existing)
    return aliases.map((alias) =>
      alias === existing
        ? { ...alias, timesConfirmed: alias.timesConfirmed + 1 }
        : alias,
    );
  return [...aliases, { said: wanted, kind, targetId, timesConfirmed: 1 }];
}
