"use client";

import { getAppCheckToken } from "@/lib/firebase/app-check";
import { activeMembership } from "@/lib/firebase/active-membership";
import { getFirebaseClient } from "@/lib/firebase/client";

type AiQueueCommand =
  | {
      type: "decideAiAction";
      input: {
        actionId: string;
        decision: "approved" | "rejected" | "dismissed";
        note?: string;
        editDelta?: Record<string, unknown>;
        consequence?: string;
      };
    }
  | {
      type: "snoozeAiAction";
      input: { actionId: string; snoozedUntil: string };
    }
  | {
      type: "decideAutomationApproval";
      input: {
        approvalId: string;
        decision: "approved" | "rejected";
        note?: string;
      };
    }
  | {
      type: "recordAiExecution";
      input: {
        actionId: string;
        commandId: string;
        summary: string;
        providerEvidence?: Record<string, unknown> | null;
      };
    }
  | {
      type: "cancelReceipt" | "retryReceipt";
      input: { receiptId: string };
    };

function endpoint() {
  return (
    process.env.NEXT_PUBLIC_AI_ACTION_FUNCTIONS_URL ??
    process.env.NEXT_PUBLIC_WORKFLOW_FUNCTIONS_URL
  );
}

export async function runAiQueueCommand(
  command: AiQueueCommand,
): Promise<Record<string, unknown>> {
  const baseUrl = endpoint();
  if (!baseUrl)
    throw new Error("AI approval commands are unavailable in preview mode.");
  const client = getFirebaseClient();
  const user = client.auth.currentUser;
  if (!user) throw new Error("Sign in before reviewing AI work.");
  const membership = await activeMembership(client.firestore, user.uid);
  const appCheckToken = await getAppCheckToken();
  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/aiActionCommand`,
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
        tenantId: String(membership.data().tenantId),
        idempotencyKey: crypto.randomUUID(),
        ...command,
      }),
    },
  );
  const result = (await response.json()) as Record<string, unknown> & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(result.error ?? "AI approval could not be updated.");
  return result;
}
