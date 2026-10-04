import type { DocumentReference, DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { jobPackageSnapshotIds } from "../ai/schedule-package-facts.js";

/**
 * Every package on a job, read as one for money.
 *
 * The accepted proposal is what a client agreed to, and it already carries
 * the combined price of every package on the job. But each money path had a
 * fallback for a job with no accepted proposal — an imported booking, a job
 * booked straight from a package — and every fallback read the primary
 * snapshot alone. A wedding sold as photo plus video, booked without a
 * proposal, billed its final balance on the photo package and quietly
 * forgave the film (change-your-mind audit, multi-package).
 *
 * `combinedSnapshot` answers `get` the way one snapshot does, so a fallback
 * written against a single snapshot reads the whole job unchanged: money
 * fields are summed across the job's packages, everything else is the
 * primary's.
 */

const SUMMED_FIELDS = new Set(["totalCents", "taxCents", "retainerCents", "subtotalCents", "discountCents"]);

type SnapshotLike = { get(field: string): unknown };

export function combinedSnapshot(snapshots: readonly SnapshotLike[]): SnapshotLike {
  return {
    get(field: string): unknown {
      if (!SUMMED_FIELDS.has(field)) return snapshots[0]?.get(field);
      const values = snapshots
        .map((snapshot) => snapshot.get(field))
        .filter((value) => value !== undefined && value !== null);
      if (!values.length) return undefined;
      return values.reduce<number>((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
    },
  };
}

/**
 * The job's snapshots, primary first, that exist and belong to the tenant.
 * `read` is `transaction.get` inside a transaction, or a plain `get`.
 */
export async function readJobSnapshots(
  db: Firestore,
  project: unknown,
  tenantId: string,
  read: (reference: DocumentReference) => Promise<DocumentSnapshot> = (reference) => reference.get(),
): Promise<DocumentSnapshot[]> {
  const fields = (typeof project === "object" && project !== null ? project : {}) as Record<string, unknown>;
  const snapshots = await Promise.all(
    jobPackageSnapshotIds(fields).map((id) => read(db.doc(`packageSnapshots/${id}`))),
  );
  return snapshots.filter((snapshot) => snapshot.exists && snapshot.get("tenantId") === tenantId);
}
