/**
 * Which names in a list belong to more than one person.
 *
 * The copilot's crew card renders a candidate as a name and a reason. Seeded
 * with two crew records both called "Conor Lawless", it rendered two identical
 * buttons — same name, same "Specialty matches the requested role", nothing to
 * choose between them. The operator picks one at random, and a job offer at a
 * fee goes to whichever record they happened to tap. `docs/cue-scenarios.md`
 * marks that as C2 and is blunt about it: asking is the right answer, not a
 * failure.
 *
 * The full staffing workspace already solved this by showing an email under
 * every candidate. That is the right call on a page and the wrong one on the
 * copilot's compact card, where a line of address under every row is noise on
 * a phone. So the qualifier is shown only where it settles something: a name
 * two people share.
 *
 * Not to be confused with `findDuplicateProfile`, which stops one person being
 * entered twice. These are different people who happen to share a name, and
 * the answer is to tell them apart rather than to merge them.
 */
export function sharedNames(
  people: readonly { name: string }[],
): ReadonlySet<string> {
  const seen = new Map<string, number>();
  for (const person of people) {
    const key = person.name.trim().toLocaleLowerCase();
    if (!key) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const shared = new Set<string>();
  for (const [key, count] of seen) if (count > 1) shared.add(key);
  return shared;
}

/** Whether this particular name needs a qualifier beside it. */
export function needsQualifier(
  name: string,
  shared: ReadonlySet<string>,
): boolean {
  return shared.has(name.trim().toLocaleLowerCase());
}
