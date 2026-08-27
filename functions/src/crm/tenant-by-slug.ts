import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";

/**
 * Find a studio by its public address, including addresses it used to have.
 *
 * A studio hands `/inquiry?studio=<slug>` out on cards, in email signatures and
 * on its website. Once the slug became editable, an exact match on the current
 * `publicSlug` would have turned every one of those into a 404 the moment a
 * studio tidied their address — which is the sort of thing that makes a feature
 * not worth having.
 *
 * `slugAliases` holds every slug the tenant has ever had, so an old link keeps
 * resolving. The fallback to `publicSlug` is for tenants created before that
 * field existed and not yet backfilled; it costs a second query only when the
 * first misses.
 */
export async function findTenantBySlug(
  db: Firestore,
  slug: string,
  statuses: readonly string[] = ["trial", "active"],
): Promise<QueryDocumentSnapshot | null> {
  const byAlias = await db
    .collection("tenants")
    .where("slugAliases", "array-contains", slug)
    .limit(2)
    .get();
  const alias = byAlias.docs.find((candidate) =>
    statuses.includes(String(candidate.get("status"))),
  );
  if (alias) return alias;

  const byCurrent = await db
    .collection("tenants")
    .where("publicSlug", "==", slug)
    .limit(2)
    .get();
  return (
    byCurrent.docs.find((candidate) =>
      statuses.includes(String(candidate.get("status"))),
    ) ?? null
  );
}
