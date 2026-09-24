/**
 * The two fields the model was asked for and never once supplied.
 *
 * `flow.subject` and `flow.role` exist so that "add marco silva as videographer"
 * opens the crew picker with Marco selected and the roster ranked against video.
 * The schema documents both, the system instruction asks for both in detail, and
 * the client honours both the moment they arrive.
 *
 * Across ten consecutive crew_offer turns on production, both were null every
 * time — including turns from before the prompt was last touched, so this is
 * not drift. The features were inert, and the symptoms their own comments
 * predict were exactly what showed up: asked to add Marco Silva as videographer,
 * the picker ranked Marco last under "Role or specialty does not match", because
 * with no role the flow falls back to a photography label.
 *
 * So they are derived from the operator's sentence rather than requested from
 * the model. The sentence is right there, the rules are small, and a derivation
 * that runs every time beats an instruction that runs none of the time.
 */

/**
 * Which role the operator asked to fill, in words the client's
 * `coverageRoleForLabel` already understands.
 *
 * Deliberately conservative: only the words that clearly name a trade count,
 * and anything else returns null so the flow keeps its existing behaviour of
 * asking the job what is still to book.
 */
export function deriveFlowRole(question: string): string | null {
  const said = question.toLocaleLowerCase();
  // Checked before photography, because "second shooter for the video team"
  // names video and would otherwise be read as stills.
  if (/\b(videograph\w*|cinematograph\w*|video lead|video)\b/.test(said))
    return "Videographer";
  if (/\bsecond (photographer|shooter)\b|\b2nd (photographer|shooter)\b/.test(said))
    return "Second photographer";
  if (/\b(photograph\w*|shooter|stills)\b/.test(said)) return "Photographer";
  return null;
}

/**
 * The person the operator named, if the roster has exactly one whose full name
 * they used.
 *
 * Full name only, and only when it is unambiguous. A surname match would read
 * "the baumwoll job" as a person, and a first-name match would pick one of two
 * people called Conor — which is the ambiguity C2 exists to preserve, not
 * something to guess past. Returning null leaves the picker exactly as it is
 * today, which is a safe floor.
 */
export function deriveFlowSubject(
  question: string,
  crewNames: readonly string[],
): string | null {
  const said = question.toLocaleLowerCase();
  const hits = crewNames.filter((name) => {
    const trimmed = name.trim().toLocaleLowerCase();
    return trimmed.length >= 5 && said.includes(trimmed);
  });
  // Exactly one ROSTER ENTRY, not one distinct name. Two records both called
  // "Conor Lawless" are two hits, and collapsing them to one would guess past
  // precisely the ambiguity C2 exists to preserve.
  if (hits.length !== 1) return null;
  // Give back the roster's spelling, not the operator's.
  return hits[0] ?? null;
}
