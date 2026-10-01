"use client";

import { getAuth } from "firebase/auth";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { markTenantRecordsWritten } from "@/lib/live/record-writes";
import type { FeedbackKind, FeedbackStatus } from "@/features/feedback/model";

/**
 * Callers for functions/src/feedback/commands.ts.
 *
 * With no Functions URL configured, nothing is stored or sent and the result
 * says so ("preview"), rather than thanking someone for feedback nobody will
 * read.
 */

type FeedbackRequest =
  | {
      type: "submitFeedback";
      input: {
        tenantId: string;
        kind: FeedbackKind;
        message: string;
        followUpOk: boolean;
        context: {
          route: string;
          viewport: string | null;
          userAgent: string | null;
          lastError: string | null;
        };
        screenshot: string | null;
      };
    }
  | {
      type: "setFeedbackStatus";
      input: { feedbackId: string; status: FeedbackStatus; note: string | null };
    };

export class FeedbackCommandError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function postFeedbackCommand<T>(
  request: FeedbackRequest,
  idempotencyKey: string,
): Promise<{ mode: "preview" } | ({ mode: "live" } & T)> {
  const endpoint = process.env.NEXT_PUBLIC_CRM_FUNCTIONS_URL;
  if (!endpoint) return { mode: "preview" };
  const client = getFirebaseClient();
  const user = getAuth(client.app).currentUser;
  if (!user) throw new FeedbackCommandError("AUTHENTICATION_REQUIRED");
  const appCheckToken = await getAppCheckToken();
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/feedbackCommand`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await user.getIdToken()}`,
      ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
    },
    body: JSON.stringify({ ...request, idempotencyKey }),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new FeedbackCommandError(payload.error ?? "FEEDBACK_FAILED");
  markTenantRecordsWritten();
  return { mode: "live", ...payload };
}

export function submitFeedback(
  input: Extract<FeedbackRequest, { type: "submitFeedback" }>["input"],
  idempotencyKey: string,
) {
  return postFeedbackCommand<{ feedbackId: string; duplicate: boolean }>(
    { type: "submitFeedback", input },
    idempotencyKey,
  );
}

export function setFeedbackStatus(input: { feedbackId: string; status: FeedbackStatus; note: string | null }) {
  return postFeedbackCommand<{ status: FeedbackStatus; notified: boolean }>(
    { type: "setFeedbackStatus", input },
    `status_${input.feedbackId}_${input.status}_${Date.now()}`,
  );
}

/** What to tell the person when sending fails. */
export function feedbackErrorMessage(error: unknown): string {
  const code = error instanceof FeedbackCommandError ? error.code : "";
  if (code === "RATE_LIMITED") return "That's a lot of feedback in one hour. Please try again a little later.";
  if (code === "SCREENSHOT_TOO_LARGE" || code === "SCREENSHOT_INVALID")
    return "The screenshot couldn't be sent. Remove it and try again.";
  if (code === "FORBIDDEN") return "Feedback is sent from a studio workspace. Switch to your studio and try again.";
  if (code === "AUTHENTICATION_REQUIRED") return "Your session has ended. Sign in again to send feedback.";
  return "Your feedback didn't send. Check your connection and try again.";
}
