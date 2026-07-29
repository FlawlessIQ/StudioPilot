"use client";

import type {
  Firestore,
  QueryDocumentSnapshot,
} from "firebase/firestore";
import { loadMembershipDocuments } from "@/lib/firebase/membership-cache";

export async function activeMembership(
  firestore: Firestore,
  userId: string,
): Promise<QueryDocumentSnapshot> {
  const documents = await loadMembershipDocuments(firestore, userId);
  const preferredTenantId =
    typeof window === "undefined"
      ? null
      : window.localStorage.getItem("studiohub.activeTenantId");
  const membership =
    documents.find(
      (document) => document.data().tenantId === preferredTenantId,
    ) ?? documents[0];
  if (!membership) throw new Error("No active studio membership was found.");
  return membership;
}
