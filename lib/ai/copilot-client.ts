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
  /**
   * Ids of aiActions the copilot proposed for this answer (client-email drafts),
   * already created server-side as review-required approval cards. The chat
   * renders them inline so the owner reviews and sends with one tap.
   */
  proposalActionIds?: string[];
  /**
   * A multi-turn conversational flow the copilot launched (gather → select →
   * form → act). Rendered inline as a FlowRunner. The model only chose the type
   * + project; the flow's steps fetch real options and take the operator's
   * input before anything runs.
   */
  flow?: CopilotFlow | null;
};

export type CopilotFlow = {
  type: "crew_offer" | "select_package";
  projectId: string;
  title: string;
  reason: string;
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

/**
 * Streaming ask: the answer text arrives token-by-token via onToken; the full
 * result (facts, citations, jobObject, threadId) resolves at the end. Falls
 * back cleanly if the platform buffers the stream — onToken simply fires once
 * near the end, and the resolved result is authoritative either way.
 */
export async function askCopilotStream(
  input: {
    tenantId: string;
    projectId?: string | null;
    question: string;
    history?: CopilotTurn[];
    threadId?: string;
  },
  onToken: (delta: string) => void,
  onStatus?: (label: string) => void,
): Promise<CopilotResult> {
  const endpoint = process.env.NEXT_PUBLIC_AI_FUNCTIONS_URL;
  if (!endpoint) throw new Error("AI Copilot is not configured.");
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before asking Copilot.");
  const appCheckToken = await getAppCheckToken();
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/aiCopilotCommand`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await user.getIdToken()}`,
      ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
    },
    body: JSON.stringify({ ...input, stream: true }),
  });
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      friendlyAiError(
        new Error(payload.error ?? ""),
        "The assistant couldn't answer that. Try again.",
      ),
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: CopilotResult | null = null;
  const handleFrame = (frame: string) => {
    const line = frame.split("\n").find((l) => l.startsWith("data:"));
    if (!line) return;
    const raw = line.slice(5).trim();
    if (!raw) return;
    const event = JSON.parse(raw) as {
      token?: string;
      status?: string;
      done?: CopilotResult;
      error?: string;
    };
    if (typeof event.status === "string") onStatus?.(event.status);
    else if (typeof event.token === "string") onToken(event.token);
    else if (event.done) done = event.done;
    else if (event.error)
      throw new Error(
        friendlyAiError(new Error(event.error), "The assistant couldn't answer that."),
      );
  };
  for (;;) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      handleFrame(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
  }
  if (buffer.trim()) handleFrame(buffer);
  if (!done) throw new Error("The assistant's answer ended unexpectedly. Try again.");
  return done;
}
