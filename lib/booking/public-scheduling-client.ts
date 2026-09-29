"use client";

/**
 * Firebase loads when a call is made, not with the page. The couple's
 * inquiry link and the consultation invite are public pages reached from an
 * email on a phone, and a static import put Auth, Firestore and App Check in
 * front of them (the same weight removed from the inquiry form, 2026-09-28).
 */
export async function runPublicScheduling(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { getAppCheckToken } = await import("@/lib/firebase/app-check");
  const appCheckToken = await getAppCheckToken();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
  };
  let requestBody = body;
  if (body.type === "create_link") {
    const [{ getFirebaseClient }, { activeMembership }] = await Promise.all([
      import("@/lib/firebase/client"),
      import("@/lib/firebase/active-membership"),
    ]);
    const client = getFirebaseClient();
    const user = client.auth.currentUser;
    if (!user) throw new Error("Sign in before sending a scheduling link.");
    const membership = await activeMembership(client.firestore, user.uid);
    headers.authorization = `Bearer ${await user.getIdToken()}`;
    requestBody = {
      ...body,
      tenantId: String(membership.data().tenantId),
    };
  }
  const response = await fetch(
    "/api/functions/publicConsultationScheduling",
    {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      String(payload.error ?? "Consultation scheduling could not continue."),
    );
  }
  return payload;
}
