import { canTransition } from "@/features/projects/state-machine";
import type { ProjectState } from "@/features/projects/schema";

export type ClientProposalDecision = "accepted" | "declined";

export type ProposalDecisionInput = {
  decision: ClientProposalDecision;
  now: string;
  project: {
    state: string;
    packageSnapshotId: string | null;
    /** The packages beside the main one (photo and video, say). */
    additionalPackageSnapshotIds?: readonly string[];
  };
  proposal: {
    status: string;
    expiresAt: string;
    packageSnapshotId: string;
    additionalPackageSnapshotIds?: readonly string[];
  };
};

/**
 * The statuses a couple is ever shown. Drafts, internal review, approved but
 * unsent, and discarded versions are the studio's own.
 */
export const COUPLE_VISIBLE_PROPOSAL_STATUSES = [
  "sent",
  "viewed",
  "accepted",
  "declined",
  "expired",
  "superseded",
  "withdrawn",
] as const;

/**
 * The proposal the couple's page treats as current: the newest version they
 * have been given. The newest version outright was used before, so a reissue
 * or package revise — which writes a new draft — told a couple holding a
 * proposal that it was still being prepared.
 */
export function currentCoupleProposal<T>(
  proposals: readonly T[],
  read: (proposal: T) => { status: unknown; version: unknown },
): T | undefined {
  return [...proposals]
    .filter((proposal) =>
      (COUPLE_VISIBLE_PROPOSAL_STATUSES as readonly string[]).includes(String(read(proposal).status ?? "")),
    )
    .sort((left, right) => Number(read(right).version ?? 0) - Number(read(left).version ?? 0))[0];
}

/** Every package, main first, as one comparable list. */
function packageList(primary: string | null, additional: readonly string[] | undefined): string {
  return [primary ?? "", ...(additional ?? [])].filter(Boolean).join("|");
}

export type ProposalDecisionPlan = {
  alreadyComplete: boolean;
  proposalStatus: ClientProposalDecision;
  projectState: ProjectState;
  transitionProject: boolean;
};

export function planClientProposalDecision(
  input: ProposalDecisionInput,
): ProposalDecisionPlan {
  const { decision, project, proposal } = input;

  if (proposal.status === decision) {
    return {
      alreadyComplete: true,
      proposalStatus: decision,
      projectState: project.state as ProjectState,
      transitionProject: false,
    };
  }

  if (!["sent", "viewed"].includes(proposal.status)) {
    throw new Error("PROPOSAL_NOT_ACTIONABLE");
  }

  const expiresAt = new Date(proposal.expiresAt);
  const now = new Date(input.now);
  if (
    Number.isNaN(expiresAt.valueOf()) ||
    Number.isNaN(now.valueOf()) ||
    expiresAt <= now
  ) {
    throw new Error("PROPOSAL_EXPIRED");
  }

  // The whole list, not only the main package: adding video beside the
  // photography, or changing an extra on it, leaves the main one where it was
  // while the proposal no longer prices what the job holds.
  if (
    project.packageSnapshotId &&
    packageList(project.packageSnapshotId, project.additionalPackageSnapshotIds) !==
      packageList(proposal.packageSnapshotId, proposal.additionalPackageSnapshotIds)
  ) {
    throw new Error("PACKAGE_SNAPSHOT_CONFLICT");
  }

  if (decision === "declined") {
    return {
      alreadyComplete: false,
      proposalStatus: "declined",
      projectState: project.state as ProjectState,
      transitionProject: false,
    };
  }

  // Said as what it is to the couple. "Your project has already moved beyond
  // this proposal" was the answer for a wedding on hold or called off, which
  // it had not (go-back audit, 2026-09-30).
  if (project.state === "POSTPONED") throw new Error("PROJECT_ON_HOLD");
  if (["CANCELLED", "LOST", "ARCHIVED"].includes(project.state)) {
    throw new Error("PROJECT_NOT_ACTIVE");
  }
  if (
    project.state !== "PROPOSAL" ||
    !canTransition(project.state as ProjectState, "CONTRACT_PENDING")
  ) {
    throw new Error("PROJECT_STATE_CONFLICT");
  }

  return {
    alreadyComplete: false,
    proposalStatus: "accepted",
    projectState: "CONTRACT_PENDING",
    transitionProject: true,
  };
}
