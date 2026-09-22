"use client";

import { friendlyAiError } from "@/lib/ai/friendly-error";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import {
  connectStorageEmulator,
  getStorage,
  ref,
  uploadBytes,
} from "firebase/storage";
import type {
  SignedAgreementAssessment,
  SignedAgreementReading,
} from "@/features/booking/signed-agreement-match";

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
  type: "crew_offer" | "select_package" | "select_questionnaire";
  projectId: string;
  title: string;
  reason: string;
  /**
   * Who or what the operator named, in their own words — never an id.
   * Matched to a real record by features/ai/flow-subject.ts. Absent when they
   * named nothing specific, and the flow then behaves as it always has.
   */
  subject?: string | null;
  /**
   * The role the operator asked to fill, in their own words ("as
   * videographer", "second shooter"). The crew flow opens on it and
   * `coverageRoleForLabel` reads the trade out of it. Absent when they did not
   * say, and the flow then opens on its long-standing default.
   */
  role?: string | null;
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

async function postCopilot<T>(
  body: Record<string, unknown>,
  fallback = "Couldn't load your conversations. Try again.",
): Promise<T> {
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
        fallback,
      ),
    );
  return payload;
}

/** The studio's saved copilot voice (tone / sign-off for email drafts), or null. */
export async function getCopilotVoice(tenantId: string): Promise<string | null> {
  const { voice } = await postCopilot<{ voice: string | null }>({
    kind: "get_copilot_voice",
    tenantId,
  });
  return voice ?? null;
}

/** Save the studio's copilot voice (owner/admin only). Returns the stored value. */
export async function setCopilotVoice(
  tenantId: string,
  voice: string,
): Promise<string | null> {
  const { voice: saved } = await postCopilot<{ voice: string | null }>({
    kind: "set_copilot_voice",
    tenantId,
    voice,
  });
  return saved ?? null;
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

export type SignedAgreementReadResult = {
  status: "read";
  /** "unavailable" when no model is configured: nothing was read, nothing guessed. */
  mode: "ai" | "unavailable";
  reading: SignedAgreementReading;
  /** What else the contract states, for importing it as an existing booking. */
  details: {
    clientEmails: string[];
    clientPhones: string[];
    packageName: string | null;
    contractTotal: number | null;
    taxAmount: number | null;
    coverageHours: number | null;
    photographers: number | null;
    videographers: number | null;
    venueName: string | null;
    city: string | null;
    retainerAmount: number | null;
  };
  assessment: SignedAgreementAssessment;
  candidates: Array<{
    projectId: string;
    projectName: string;
    proposalId: string | null;
  }>;
};

let cueStorageEmulatorConnected = false;

const readableAttachment = /^(application\/pdf|image\/jpeg|image\/png)$/;
const maxAttachmentBytes = 25 * 1024 * 1024;

/**
 * Hand a signed agreement to Cue and get back what it read.
 *
 * Stages the file in the owner's own Cue folder, then asks Cue to read it. The
 * malware scan runs on upload and Cue refuses to read before it clears, so
 * "scanning" is a normal answer: this waits and asks again, briefly. The
 * staged copy is deleted by the server once read.
 *
 * Nothing is recorded. The result prefills the "Record the signature" form,
 * which uploads the signed copy to the project when a person submits it.
 */
export async function readSignedAgreementAttachment(input: {
  tenantId: string;
  file: File;
  onScanning?: () => void;
}): Promise<SignedAgreementReadResult> {
  if (!readableAttachment.test(input.file.type))
    throw new Error("Cue can read a PDF, JPEG or PNG. Attach the signed agreement in one of those.");
  if (input.file.size >= maxAttachmentBytes)
    throw new Error("That file is over 25 MB. Attach a smaller copy of the signed agreement.");
  if (!process.env.NEXT_PUBLIC_AI_FUNCTIONS_URL)
    throw new Error("AI Copilot is not configured.");
  const client = getFirebaseClient();
  const user = client.auth.currentUser;
  if (!user) throw new Error("Sign in before attaching a file.");
  const storage = getStorage(client.app);
  if (
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" &&
    !cueStorageEmulatorConnected
  ) {
    connectStorageEmulator(storage, "127.0.0.1", 9199);
    cueStorageEmulatorConnected = true;
  }
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  const attachmentPath = `tenants/${input.tenantId}/cueAttachments/${user.uid}/${crypto.randomUUID()}-${safeName}`;
  await uploadBytes(ref(storage, attachmentPath), input.file, {
    contentType: input.file.type,
    customMetadata: { scanStatus: "pending", visibility: "studio" },
  });

  // The scan usually clears in seconds. Wait a little longer each time, and
  // give up well before anyone wonders whether it is still working.
  const delays = [1500, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000];
  for (let attempt = 0; ; attempt += 1) {
    const result = await postCopilot<
      | SignedAgreementReadResult
      | { status: "scanning" }
      | { status: "blocked"; reason: "unsafe" | "scanner_unavailable" | "unsupported" }
    >(
      {
        kind: "read_signed_agreement",
        tenantId: input.tenantId,
        attachmentPath,
      },
      "Cue couldn't read that file. Try attaching it again.",
    );
    if (result.status === "read") return result;
    if (result.status === "blocked") {
      throw new Error(
        result.reason === "unsafe"
          ? "That file didn't pass the safety scan, so Cue won't open it."
          : result.reason === "unsupported"
            ? "Cue can read a PDF, JPEG or PNG. Attach the signed agreement in one of those."
            : "File scanning is unavailable right now, so Cue can't open attachments. You can still record the signature on the job.",
      );
    }
    const delay = delays[attempt];
    if (delay === undefined)
      throw new Error(
        "The file is still being scanned. Try attaching it again in a minute.",
      );
    input.onScanning?.();
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
