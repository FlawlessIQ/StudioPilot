"use client";

import { prefillFromText } from "@/features/crm/project-prefill";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

export type ProjectIntake = {
  firstName: string | null;
  lastName: string | null;
  partnerName: string | null;
  email: string | null;
  phone: string | null;
  eventType: "Wedding" | "Corporate" | "Sports" | null;
  eventDate: string | null;
  venueName: string | null;
  city: string | null;
  guestCount: number | null;
  summary: string | null;
};

export type ProjectIntakeResult = {
  extraction: ProjectIntake;
  /** ai = Vertex read the message; quick = the local deterministic engine. */
  mode: "ai" | "quick";
};

const quickRead = (message: string): ProjectIntakeResult => ({
  extraction: {
    ...prefillFromText(message),
    guestCount: null,
    summary: null,
  },
  mode: "quick",
});

/**
 * Read a pasted client message into structured intake fields. The AI does
 * the reading; the studio confirms every field before anything is created.
 * Any failure — endpoint unconfigured, quota, model outage — degrades to
 * the local deterministic engine rather than an error.
 */
export async function readProjectIntake(
  tenantId: string,
  message: string,
): Promise<ProjectIntakeResult> {
  const endpoint = process.env.NEXT_PUBLIC_AI_FUNCTIONS_URL;
  if (!endpoint) return quickRead(message);
  try {
    const { auth } = getFirebaseClient();
    const user = auth.currentUser;
    if (!user) return quickRead(message);
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
        body: JSON.stringify({ kind: "project_intake", tenantId, message }),
      },
    );
    if (!response.ok) return quickRead(message);
    const body = (await response.json().catch(() => null)) as {
      extraction?: ProjectIntake;
      mode?: string;
    } | null;
    if (!body?.extraction) return quickRead(message);
    return {
      extraction: body.extraction,
      mode: body.mode === "ai" ? "ai" : "quick",
    };
  } catch {
    return quickRead(message);
  }
}
