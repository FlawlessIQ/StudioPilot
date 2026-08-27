/**
 * Catching a collaborator you already have.
 *
 * `createCrewProfile` wrote a new profile every time it was called, with no
 * check on the email — so the production directory ended up with two entries on
 * the same address, differing only by how the name had been typed. A duplicate
 * person is not cosmetic: crew are ranked and offered work per job, so the same
 * photographer can be offered the same wedding twice, acknowledge on one entry
 * and appear unresponsive on the other, and have their W-9 verified against a
 * record nobody is looking at.
 *
 * Email is the identity here because it is what the crew invitation is sent to
 * and what the person signs in with. Names are typed differently by the same
 * studio on the same day; the address is not.
 *
 * An archived match is reported separately, because "you removed this person"
 * and "you already have this person" call for different next steps and silently
 * creating a second entry is the wrong answer to both.
 */

export type ExistingProfile = {
  id: string;
  email: string;
  name: string;
  archivedAt: string | null;
};

export type DuplicateVerdict =
  | { kind: "unique" }
  | { kind: "active"; profileId: string; name: string }
  | { kind: "archived"; profileId: string; name: string };

/** Same rule as `normalizedEmail` on contacts, so the two agree. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Whether this email already belongs to someone in the directory.
 *
 * `ignoreProfileId` is for the edit path: changing an entry's own email must
 * not collide with itself.
 */
export function findDuplicateProfile(
  email: string,
  existing: readonly ExistingProfile[],
  ignoreProfileId?: string,
): DuplicateVerdict {
  const target = normalizeEmail(email);
  if (!target) return { kind: "unique" };
  const matches = existing.filter(
    (profile) =>
      profile.id !== ignoreProfileId &&
      normalizeEmail(profile.email) === target,
  );
  // An active entry is the more useful thing to point at, so it is checked
  // first even when an archived one also matches.
  const active = matches.find((profile) => !profile.archivedAt);
  if (active) {
    return { kind: "active", profileId: active.id, name: active.name };
  }
  const archived = matches[0];
  if (archived) {
    return { kind: "archived", profileId: archived.id, name: archived.name };
  }
  return { kind: "unique" };
}
