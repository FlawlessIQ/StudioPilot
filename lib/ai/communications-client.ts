"use client";

import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

export type CommunicationAssistantResult = {
  subject: string;
  body: string;
  factsUsed: string[];
  needsConfirmation: string[];
  interactionId: string;
  asOf: string;
};

export async function draftCommunication(input: {
  tenantId: string;
  projectId: string;
  contactId: string;
  instruction: string;
  category: "general" | "financial" | "contract" | "insurance";
  currentSubject?: string | null;
  currentBody?: string | null;
}): Promise<CommunicationAssistantResult> {
  const endpoint = process.env.NEXT_PUBLIC_AI_FUNCTIONS_URL;
  if (!endpoint) throw new Error("AI communications are not configured.");
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before asking StudioCue to draft.");
  const appCheckToken = await getAppCheckToken();
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/aiCommunicationsCommand`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      },
      body: JSON.stringify(input),
    },
  );
  const result = (await response.json()) as CommunicationAssistantResult & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(result.error ?? "StudioCue could not prepare this email.");
  return result;
}
