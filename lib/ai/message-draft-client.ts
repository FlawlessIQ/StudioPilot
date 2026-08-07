"use client";

import { friendlyAiError } from "@/lib/ai/friendly-error";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

export type MessageDraftTrigger =
  | "inquiry_reply"
  | "consultation_dates"
  | "proposal_cover"
  | "schedule_confirmation"
  | "final_invoice_notice"
  | "day_before_checklist"
  | "delivery_note"
  | "album_selection_reminder"
  | "review_request";

export type MessageDraftResult =
  | { mode: "preview"; actionId: null }
  | { mode: "live"; actionId: string };

/**
 * Ask the server to prepare a client-message draft. The draft always lands in
 * the AI review queue — this call never sends anything. Preview mode (no
 * functions URL configured) discloses itself instead of failing.
 */
export async function requestMessageDraft(input: {
  tenantId: string;
  trigger: MessageDraftTrigger;
  leadId?: string | null;
  projectId?: string | null;
  instructions?: string;
}): Promise<MessageDraftResult> {
  const endpoint = process.env.NEXT_PUBLIC_AI_FUNCTIONS_URL;
  if (!endpoint) return { mode: "preview", actionId: null };
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before drafting a message.");
  const appCheckToken = await getAppCheckToken();
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/aiMessageDraftCommand`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      },
      body: JSON.stringify({
        tenantId: input.tenantId,
        trigger: input.trigger,
        leadId: input.leadId ?? null,
        projectId: input.projectId ?? null,
        instructions: input.instructions ?? "",
      }),
    },
  );
  const result = (await response.json()) as {
    actionId?: string;
    error?: string;
  };
  if (!response.ok || !result.actionId)
    throw new Error(
      friendlyAiError(
        new Error(result.error ?? ""),
        "We couldn't prepare this draft. Try again.",
      ),
    );
  return { mode: "live", actionId: result.actionId };
}
