"use client";

import { getAuth } from "firebase/auth";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { activeMembership } from "@/lib/firebase/active-membership";

export async function sendBookingCommand(input: Record<string, unknown>) {
  const endpoint = process.env.NEXT_PUBLIC_BOOKING_FUNCTIONS_URL;
  if (!endpoint) return { mode: "preview" as const };
  const client = getFirebaseClient();
  const user = getAuth(client.app).currentUser;
  if (!user) throw new Error("Sign in before changing booking records.");
  const membership = await activeMembership(client.firestore, user.uid);
  const appCheckToken = await getAppCheckToken();
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/bookingCommand`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await user.getIdToken()}`,
      ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
    },
    body: JSON.stringify({ ...input, tenantId: membership.data().tenantId as string }),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      String(payload.error ?? "Booking command could not be completed."),
    );
  }
  return { mode: "live" as const, payload };
}

export type ConsultationAvailabilityQueryResult = {
  settings: Record<string, unknown>;
  busy: { start: string; end: string }[];
  calendarStatus: "connected" | "unavailable";
};

/**
 * Studio settings + booked/busy intervals (internal bookings merged with
 * the connected Google Calendar's real freebusy) for the consultation
 * calendar. Read-only — falls back to a non-persisting preview shape when
 * NEXT_PUBLIC_BOOKING_FUNCTIONS_URL is unset, same disclosure pattern as
 * sendBookingCommand.
 */
export async function queryConsultationAvailability(): Promise<
  | { mode: "preview" }
  | { mode: "live"; payload: ConsultationAvailabilityQueryResult }
> {
  const endpoint = process.env.NEXT_PUBLIC_BOOKING_FUNCTIONS_URL;
  if (!endpoint) return { mode: "preview" as const };
  const client = getFirebaseClient();
  const user = getAuth(client.app).currentUser;
  if (!user) throw new Error("Sign in to view consultation availability.");
  const membership = await activeMembership(client.firestore, user.uid);
  const appCheckToken = await getAppCheckToken();
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/consultationAvailabilityQuery`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      },
      body: JSON.stringify({ tenantId: membership.data().tenantId as string }),
    },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      String(payload.error ?? "Could not load consultation availability."),
    );
  }
  return {
    mode: "live" as const,
    payload: payload as unknown as ConsultationAvailabilityQueryResult,
  };
}
