"use client";

import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

export type ProposalDraftResult = {
  introduction: string;
  termsSummary: string;
  /** ai = drafted by the model; template = the deterministic fallback. */
  mode: "ai" | "template";
};

/**
 * Draft the proposal's client-facing introduction and terms summary from
 * the consultation review and the locked package snapshot. Copy only —
 * pricing, dates, and legal terms are never authored here. Throws when the
 * server can't produce a draft; the caller shows a friendly notice and the
 * fields stay editable by hand.
 */
export async function draftProposalCopy(
  tenantId: string,
  projectId: string,
): Promise<ProposalDraftResult> {
  const endpoint = process.env.NEXT_PUBLIC_AI_FUNCTIONS_URL;
  if (!endpoint) throw new Error("VERTEX_AI_COPILOT_NOT_CONFIGURED");
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("FORBIDDEN");
  const appCheckToken = await getAppCheckToken();
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/aiCopilotCommand`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      },
      body: JSON.stringify({ kind: "proposal_drafting", tenantId, projectId }),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    draft?: { introduction?: string; termsSummary?: string };
    mode?: string;
    error?: string;
  };
  if (!response.ok || !body.draft?.introduction)
    throw new Error(body.error ?? "PROPOSAL_DRAFT_FAILED");
  return {
    introduction: body.draft.introduction,
    termsSummary: body.draft.termsSummary ?? "",
    mode: body.mode === "ai" ? "ai" : "template",
  };
}
