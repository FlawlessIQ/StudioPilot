"use client";

import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

type CrmCommandResult = Record<string, unknown>;

export async function runCrmCommand(
  type: string,
  input: Record<string, unknown>,
): Promise<{ persisted: boolean; result: CrmCommandResult }> {
  const endpoint = process.env.NEXT_PUBLIC_CRM_FUNCTIONS_URL;
  if (!endpoint) {
    return {
      persisted: false,
      result: { reference: `DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}` },
    };
  }

  const { auth, firestore } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before making studio changes.");
  const memberships = await getDocs(
    query(
      collection(firestore, "memberships"),
      where("userId", "==", user.uid),
      where("status", "==", "active"),
      limit(1),
    ),
  );
  const membership = memberships.docs[0];
  if (!membership) throw new Error("No active studio membership was found.");

  const appCheckToken = await getAppCheckToken();
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/crmCommand`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await user.getIdToken()}`,
      ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
    },
    body: JSON.stringify({
      type,
      tenantId: membership.data().tenantId as string,
      idempotencyKey: crypto.randomUUID(),
      input,
    }),
  });
  const result = (await response.json()) as CrmCommandResult;
  if (!response.ok) {
    throw new Error(typeof result.error === "string" ? result.error : "Studio command failed.");
  }
  return { persisted: true, result };
}
