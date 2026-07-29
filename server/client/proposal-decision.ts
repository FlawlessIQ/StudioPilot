import { canTransition } from "@/features/projects/state-machine";
import type { ProjectState } from "@/features/projects/schema";

export type ClientProposalDecision = "accepted" | "declined";

export type ProposalDecisionInput = {
  decision: ClientProposalDecision;
  now: string;
  project: {
    state: string;
    packageSnapshotId: string | null;
  };
  proposal: {
    status: string;
    expiresAt: string;
    packageSnapshotId: string;
  };
};

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

  if (
    project.packageSnapshotId &&
    project.packageSnapshotId !== proposal.packageSnapshotId
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
