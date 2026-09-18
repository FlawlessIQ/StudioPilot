/**
 * Whether a job has been put away.
 *
 * A job is put away either by reaching the ARCHIVED state or by carrying an
 * `archivedAt` — which is how every other list in the product decides (leads,
 * contacts, vendors, crew, and the generic domain view all read the field).
 * Reading only the state left jobs archived elsewhere on the Jobs list for
 * ever, and out of the Archived tab; that was fixed on the list, and then the
 * same jobs turned up again in every *picker*. A studio recording a gallery was
 * offered five archived weddings, one of them a questionnaire test, in the
 * dropdown that chooses whose photographs go out.
 *
 * So it is one predicate now, and a picker that wants only live jobs says so.
 *
 * Pure.
 */

export function isPutAway(project: unknown): boolean {
  const fields = (project ?? {}) as { state?: unknown; archivedAt?: unknown };
  return fields.state === "ARCHIVED" || Boolean(fields.archivedAt);
}

/**
 * The jobs a studio can still act on — what every picker should offer.
 *
 * Unconstrained in T on purpose: the callers hold everything from a loose
 * `TenantDocument` to a narrow option type, and a shape constraint of two
 * optional fields is a weak type that TypeScript refuses the former for.
 */
export function liveProjects<T>(
  projects: readonly T[] | null | undefined,
): T[] {
  return (projects ?? []).filter((project) => !isPutAway(project));
}
