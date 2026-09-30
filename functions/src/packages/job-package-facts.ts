import type { Firestore } from "firebase-admin/firestore";
import { jobPackageSnapshotIds } from "../crew/staffing-plan.js";
import { retainerFromSchedule } from "../booking/agreed-retainer.js";
import { combineCoverage, describeCoverage, resolveCoverage } from "./coverage.js";
import { packageInclusionItems } from "./inclusions.js";

/**
 * What the AI is told about the packages on a job — all of them.
 *
 * Cue's project detail, the message drafter and the proposal-copy drafter
 * each read `packageSnapshotId` and nothing else, so on a wedding sold as
 * photo plus video (GR Productions) the model knew the photo package alone:
 * it answered "what's included" and "what does it cost" from half the job,
 * and drafted client copy that never mentioned the video. Every package goes
 * in now, primary first, with its own inclusions and terms, the crew summed
 * across them, and the total the couple agreed — the accepted proposal's,
 * or the packages added up before one is accepted.
 */

type Row = Record<string, unknown>;

export type JobPackageFact = {
  snapshotId: string;
  packageName: string;
  /** "2 photographers and 1 videographer" — never a role it doesn't send. */
  coverage: string;
  includedCoverageMinutes: number | null;
  /** The bullets the proposal shows (its own, once one is accepted). */
  inclusions: string[];
  includedDeliverables: unknown[];
  terms: string | null;
  totalCents: number | null;
  retainerCents: number | null;
};

export type JobPackageFacts = {
  packages: JobPackageFact[];
  packageNames: string[];
  /** Everyone the packages send, summed (combineCoverage). */
  combinedCoverage: string;
  /** The couple's agreed total, or the packages added up; null if unknown. */
  totalCents: number | null;
  totalSource: "accepted_proposal" | "package_snapshots" | null;
  /** The agreed retainer: the accepted schedule's, else the packages' summed. */
  retainerCents: number | null;
};

const cents = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
};

export function jobPackageFacts(input: {
  snapshots: readonly { id: string; data: Row }[];
  acceptedProposal?: Row | null;
}): JobPackageFacts | null {
  if (!input.snapshots.length) return null;
  const accepted = input.acceptedProposal ?? null;
  const details = Array.isArray(accepted?.packageDetails) ? (accepted.packageDetails as Row[]) : [];
  const packages = input.snapshots.map(({ id, data }): JobPackageFact => {
    const detail = details.find((entry) => entry && entry.snapshotId === id);
    const agreedItems = Array.isArray(detail?.items) ? detail.items.map(String) : [];
    const minutes = Number(data.includedCoverageMinutes ?? data.coverageMinutes);
    const terms = typeof data.terms === "string" ? data.terms.trim() : "";
    return {
      snapshotId: id,
      packageName:
        typeof data.packageName === "string" && data.packageName ? data.packageName : "Package",
      coverage: describeCoverage(resolveCoverage(data)),
      includedCoverageMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
      inclusions: agreedItems.length ? agreedItems : packageInclusionItems(data.description),
      includedDeliverables: Array.isArray(data.includedDeliverables) ? data.includedDeliverables : [],
      terms: terms || null,
      totalCents: cents(data.totalCents),
      retainerCents: cents(data.retainerCents),
    };
  });
  const pricing = (accepted?.pricingSnapshot ?? null) as Row | null;
  const agreedTotal = cents(pricing?.totalCents);
  const summedTotal = packages.every((entry) => entry.totalCents !== null)
    ? packages.reduce((sum, entry) => sum + (entry.totalCents ?? 0), 0)
    : null;
  const summedRetainer = packages.every((entry) => entry.retainerCents !== null)
    ? packages.reduce((sum, entry) => sum + (entry.retainerCents ?? 0), 0)
    : null;
  const fromProposal = accepted !== null && agreedTotal !== null && agreedTotal > 0;
  return {
    packages,
    packageNames: packages.map((entry) => entry.packageName),
    combinedCoverage: describeCoverage(
      combineCoverage(input.snapshots.map(({ data }) => resolveCoverage(data))),
    ),
    totalCents: fromProposal ? agreedTotal : summedTotal,
    totalSource: fromProposal ? "accepted_proposal" : summedTotal !== null ? "package_snapshots" : null,
    retainerCents: accepted
      ? retainerFromSchedule(accepted.paymentSchedule, summedRetainer ?? 0)
      : summedRetainer,
  };
}

/** The job's current snapshots, primary first, each confirmed to be the tenant's. */
export async function loadJobPackageSnapshots(
  db: Firestore,
  tenantId: string,
  project: Row,
): Promise<{ id: string; data: Row }[]> {
  const documents = await Promise.all(
    jobPackageSnapshotIds(project).map((id) => db.doc(`packageSnapshots/${id}`).get()),
  );
  return documents
    .filter((document) => document.exists && document.get("tenantId") === tenantId)
    .map((document) => ({ id: document.id, data: document.data() ?? {} }));
}

/** The latest accepted proposal on the job, or null. */
export async function loadAcceptedProposal(
  db: Firestore,
  tenantId: string,
  projectId: string,
): Promise<Row | null> {
  const accepted = await db
    .collection("proposals")
    .where("tenantId", "==", tenantId)
    .where("projectId", "==", projectId)
    .where("status", "==", "accepted")
    .limit(5)
    .get();
  return (
    accepted.docs
      .map((document) => document.data() as Row)
      .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0] ?? null
  );
}
