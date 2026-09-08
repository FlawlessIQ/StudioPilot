"use client";

import { friendlyAiError } from "@/lib/ai/friendly-error";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

export type CopilotAttentionItem = {
  name: string;
  severity: "critical" | "warning" | "info";
  reason: string;
  dueDate: string | null;
};

export type CopilotJobObject = {
  projectId: string;
  name: string;
  eventDate: string | null;
  venue: string | null;
  state: string;
  stageIndex: number;
  stages: string[];
  readiness: { satisfied: number; total: number; ready: boolean } | null;
  recommendedNextAction: string | null;
  attention: CopilotAttentionItem[];
};

export type CopilotResult = {
  answer: string;
  facts: string[];
  suggestions: string[];
  citations: Array<{ label: string; href: string }>;
  interactionId: string;
  asOf: string;
  /** The primary project rendered as a live, record-derived object. */
  jobObject?: CopilotJobObject | null;
  /** The conversation this answer belongs to. */
  threadId?: string;
};

export type CopilotThreadSummary = {
  id: string;
  title: string;
  lastQuestion: string;
  projectId: string | null;
  turnCount: number;
  updatedAt: string;
};

export type CopilotThreadTurn =
  | { role: "user"; text: string }
  | { role: "assistant"; result: CopilotResult };

export type CopilotTurn = { role: "user" | "assistant"; text: string };

export async function askCopilot(input: {
  tenantId: string;
  projectId?: string | null;
  question: string;
  /** Prior turns of this conversation, oldest first, for follow-up context. */
  history?: CopilotTurn[];
  /** Existing conversation to append to; omit to start a new one. */
  threadId?: string;
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
    throw new Error(
      friendlyAiError(
        new Error(result.error ?? ""),
        "The assistant couldn't answer that. Try again.",
      ),
    );
  return result;
}

async function postCopilot<T>(body: Record<string, unknown>): Promise<T> {
  const endpoint = process.env.NEXT_PUBLIC_AI_FUNCTIONS_URL;
  if (!endpoint) throw new Error("AI Copilot is not configured.");
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before using Copilot.");
  const appCheckToken = await getAppCheckToken();
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/aiCopilotCommand`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await user.getIdToken()}`,
      ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(
      friendlyAiError(
        new Error((payload as { error?: string }).error ?? ""),
        "Couldn't load your conversations. Try again.",
      ),
    );
  return payload;
}

/** The signed-in owner's recent copilot conversations, newest first. */
export async function listCopilotThreads(tenantId: string): Promise<CopilotThreadSummary[]> {
  const { threads } = await postCopilot<{ threads: CopilotThreadSummary[] }>({
    kind: "list_threads",
    tenantId,
  });
  return threads;
}

/** Rebuild one conversation's turns for resume. */
export async function loadCopilotThread(
  tenantId: string,
  threadId: string,
): Promise<CopilotThreadTurn[]> {
  const { turns } = await postCopilot<{ turns: CopilotThreadTurn[] }>({
    kind: "load_thread",
    tenantId,
    threadId,
  });
  return turns;
}
