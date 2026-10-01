/**
 * Who is working a run-of-show segment.
 *
 * Schedule items named their people `photographerIds`, and that was the whole
 * vocabulary: the AI was told to put videographers in it too, but the editor
 * had no picker, the change diff called the field "photographers", and no crew
 * view ever asked whether the person looking was on a segment. A studio that
 * sells photo and video (GR Productions) had no way to say "the videographer
 * is on the speeches".
 *
 * `crewIds` is the general field: anyone assigned, whatever their trade. The
 * ids are crew profile ids. Older items carry only `photographerIds` — and the
 * seed wrote user ids there — so every reader goes through `itemCrewIds`
 * (`crewIds ?? photographerIds`) and matching accepts any of a person's ids.
 *
 * During the transition every write carries both fields with the same list
 * (`withCrewIds`), so a function or a cached page still reading
 * `photographerIds` keeps working until nothing does.
 *
 * Pure. Duplicated at functions/src/planning/item-crew.ts, which cannot import
 * from features/; tests/gap-crew-video.test.ts keeps the copies equal.
 */

export type CrewAssignable = {
  crewIds?: unknown;
  photographerIds?: unknown;
};

const ids = (value: unknown): string[] | null =>
  Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && id.length > 0)
    : null;

/** Everyone on a segment: `crewIds`, or the legacy `photographerIds`. */
export function itemCrewIds(item: CrewAssignable): string[] {
  return [...new Set(ids(item.crewIds) ?? ids(item.photographerIds) ?? [])];
}

/** The item with its crew written in both the new and the legacy field. */
export function withCrewIds<T extends CrewAssignable>(
  item: T,
  crewIds: readonly string[] = itemCrewIds(item),
): T & { crewIds: string[]; photographerIds: string[] } {
  const list = [...new Set(crewIds.filter(Boolean))];
  return { ...item, crewIds: list, photographerIds: [...list] };
}

/**
 * Whether two versions of a segment have the same people on it.
 *
 * Order-insensitive, and read through `itemCrewIds` on both sides: a version
 * published before `crewIds` existed compared against its republished self
 * must not read as a crew change, or every accepted crew member is told the
 * schedule changed when nothing about their day did.
 */
export function sameItemCrew(
  before: CrewAssignable,
  after: CrewAssignable,
): boolean {
  const left = itemCrewIds(before).sort();
  const right = itemCrewIds(after).sort();
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

/**
 * Whether the person holding these ids is on the segment.
 *
 * A crew member is known by several ids — their profile, their assignment on
 * this job, their user account — and older schedules used whichever the
 * writer had to hand. Any of them counts.
 */
export function itemIncludesCrew(
  item: CrewAssignable,
  identities: readonly (string | null | undefined)[],
): boolean {
  const assigned = new Set(itemCrewIds(item));
  return identities.some((id) => typeof id === "string" && id.length > 0 && assigned.has(id));
}
