"use client";

import { getAuth } from "firebase/auth";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

export async function sendBookingCommand(input: Record<string, unknown>) {
  const endpoint = process.env.NEXT_PUBLIC_BOOKING_FUNCTIONS_URL;
  if (!endpoint) return { mode: "preview" as const };
  const client = getFirebaseClient();
  const user = getAuth(client.app).currentUser;
  if (!user) throw new Error("Sign in before changing booking records.");
  const memberships = await getDocs(query(
    collection(client.firestore, "memberships"),
    where("userId", "==", user.uid),
    where("status", "==", "active"),
    limit(1),
  ));
  const membership = memberships.docs[0];
  if (!membership) throw new Error("No active studio membership was found.");
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
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error("Booking command could not be completed.");
  return { mode: "live" as const, payload };
}
