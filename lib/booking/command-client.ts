"use client";

import { getAuth } from "firebase/auth";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import {
  connectStorageEmulator,
  getStorage,
  ref,
  uploadBytes,
} from "firebase/storage";
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
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/bookingCommand`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      },
      body: JSON.stringify({
        ...input,
        tenantId: membership.data().tenantId as string,
      }),
    },
  );
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

let signedAgreementEmulatorConnected = false;

/**
 * Records an agreement signed outside StudioCue.
 *
 * A signing provider's API is a paid subscription, and without one a
 * project could not leave CONTRACT_PENDING by any route. This is the
 * signature equivalent of the retainer exception the booking gate already
 * accepts: a named person takes responsibility, and the record says so.
 *
 * The signed PDF is optional but uploaded first when present, so the
 * attestation and its evidence land together — the studio path under
 * `tenants/{t}/projects/{p}/` already permits studio roles to write, so no
 * new storage rule is involved.
 */
export async function recordSignedAgreement(input: {
  projectId: string;
  proposalId: string;
  signerName: string;
  signedAt: string;
  method: string;
  file: File | null;
}) {
  const endpoint = process.env.NEXT_PUBLIC_BOOKING_FUNCTIONS_URL;
  if (!endpoint) return { mode: "preview" as const };
  const client = getFirebaseClient();
  const user = getAuth(client.app).currentUser;
  if (!user) throw new Error("Sign in before recording a signature.");
  const membership = await activeMembership(client.firestore, user.uid);
  const tenantId = membership.data().tenantId as string;

  let signedDocumentId: string | null = null;
  if (input.file) {
    const storage = getStorage(client.app);
    if (
      process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" &&
      !signedAgreementEmulatorConnected
    ) {
      connectStorageEmulator(storage, "127.0.0.1", 9199);
      signedAgreementEmulatorConnected = true;
    }
    const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    signedDocumentId = `tenants/${tenantId}/projects/${input.projectId}/contracts/${crypto.randomUUID()}-${safeName}`;
    await uploadBytes(ref(storage, signedDocumentId), input.file, {
      contentType: input.file.type,
      customMetadata: { visibility: "shared", scanStatus: "pending" },
    });
  }

  return sendBookingCommand({
    type: "recordSignedAgreement",
    idempotencyKey: crypto.randomUUID(),
    input: {
      projectId: input.projectId,
      proposalId: input.proposalId,
      signerName: input.signerName,
      signedAt: input.signedAt,
      method: input.method,
      signedDocumentId,
      attestation: true,
    },
  });
}

/**
 * Recording a retainer taken outside StudioCue.
 *
 * No file upload and no amount: the amount comes from the package snapshot
 * the couple accepted, server-side, so "the retainer was paid" cannot come
 * to mean a different number than the one quoted.
 */
export async function recordRetainerPayment(input: {
  projectId: string;
  packageSnapshotId: string;
  paidAt: string;
  method: string;
  reference: string | null;
}) {
  const endpoint = process.env.NEXT_PUBLIC_BOOKING_FUNCTIONS_URL;
  if (!endpoint) return { mode: "preview" as const };
  return sendBookingCommand({
    type: "recordRetainerPayment",
    idempotencyKey: crypto.randomUUID(),
    input: {
      projectId: input.projectId,
      packageSnapshotId: input.packageSnapshotId,
      paidAt: input.paidAt,
      method: input.method,
      reference: input.reference,
      attestation: true,
    },
  });
}
