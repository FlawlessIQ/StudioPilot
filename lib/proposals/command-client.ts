"use client";

import { getAppCheckToken } from "@/lib/firebase/app-check";
import { activeMembership } from "@/lib/firebase/active-membership";
import { getFirebaseClient } from "@/lib/firebase/client";

export type ProposalCommandType =
  | "create_draft"
  | "update_draft"
  | "submit_for_approval"
  | "return_to_draft"
  | "approve"
  | "regenerate_pdf"
  | "send"
  | "resend"
  | "record_acceptance";

export type ProposalCommandResult = Record<string, unknown>;

export async function runProposalCommand(
  type: ProposalCommandType,
  input: Record<string, unknown>,
): Promise<{ persisted: boolean; result: ProposalCommandResult }> {
  const endpoint =
    process.env.NEXT_PUBLIC_PROPOSAL_FUNCTIONS_URL ??
    process.env.NEXT_PUBLIC_BOOKING_FUNCTIONS_URL;
  if (!endpoint) {
    return {
      persisted: false,
      result: {
        proposalId:
          typeof input.proposalId === "string"
            ? input.proposalId
            : `demo-proposal-${crypto.randomUUID().slice(0, 8)}`,
        status: {
          submit_for_approval: "internal_review",
          approve: "approved",
          send: "sent",
          record_acceptance: "accepted",
          return_to_draft: "draft",
        }[type as string],
        pdfState:
          type === "approve" || type === "regenerate_pdf"
            ? "queued"
            : undefined,
      },
    };
  }

  const { auth, firestore } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before changing a proposal.");
  const membership = await activeMembership(firestore, user.uid);
  const appCheckToken = await getAppCheckToken();
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/proposalCommand`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
        ...(appCheckToken
          ? { "x-firebase-appcheck": appCheckToken }
          : {}),
      },
      body: JSON.stringify({
        type,
        tenantId: membership.data().tenantId as string,
        idempotencyKey: crypto.randomUUID(),
        input,
      }),
    },
  );
  const result = (await response.json()) as ProposalCommandResult;
  if (!response.ok) {
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : "Proposal command failed.",
    );
  }
  return { persisted: true, result };
}
