"use client";

import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

export type CopilotResult = {
  answer: string;
  facts: string[];
  suggestions: string[];
  citations: Array<{ label: string; href: string }>;
  interactionId: string;
  asOf: string;
};

export async function askCopilot(input: {
  tenantId: string;
  projectId?: string | null;
  question: string;
}): Promise<CopilotResult> {
  const endpoint = process.env.NEXT_PUBLIC_AI_FUNCTIONS_URL;
  if (!endpoint) throw new Error("AI Copilot is not configured.");
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before asking Copilot.");
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
      body: JSON.stringify(input),
    },
  );
  const result = (await response.json()) as CopilotResult & { error?: string };
  if (!response.ok)
    throw new Error(result.error ?? "Copilot could not answer the question.");
  return result;
}
