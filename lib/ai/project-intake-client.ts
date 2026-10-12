"use client";

import {
  cleanOccasion,
  prefillFromText,
  readyByClock,
  storedClock,
} from "@/features/crm/project-prefill";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

export type ProjectIntake = {
  firstName: string | null;
  lastName: string | null;
  partnerName: string | null;
  email: string | null;
  phone: string | null;
  eventType: "Wedding" | "Family" | "Corporate" | "Sports" | "Other" | null;
  eventDate: string | null;
  venueName: string | null;
  city: string | null;
  guestCount: number | null;
  summary: string | null;
  /** "Sangeet": the occasion, when the message names one more particular than the kind of job. */
  occasion: string | null;
  /** When everyone must be ready, as HH:MM ("hair done by 5:30 PM" → "17:30"). */
  readyByTime: string | null;
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
      // A reply from a function deployed before the occasion and the ready-by
      // time were read carries neither: cleaned here either way. The function
      // has already read the time into HH:MM, so that is taken as it comes —
      // read again as words, "07:00" would be dropped as a guess.
      extraction: {
        ...body.extraction,
        occasion: cleanOccasion(body.extraction.occasion),
        readyByTime:
          storedClock(body.extraction.readyByTime) ??
          readyByClock(body.extraction.readyByTime),
      },
      mode: body.mode === "ai" ? "ai" : "quick",
    };
  } catch {
    return quickRead(message);
  }
}
