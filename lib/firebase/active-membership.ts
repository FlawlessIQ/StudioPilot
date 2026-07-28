"use client";

import {
  collection,
  getDocs,
  limit,
  query,
  where,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

export async function activeMembership(
  firestore: Firestore,
  userId: string,
): Promise<QueryDocumentSnapshot> {
  const snapshot = await getDocs(
    query(
      collection(firestore, "memberships"),
      where("userId", "==", userId),
      where("status", "==", "active"),
      limit(20),
    ),
  );
  const preferredTenantId =
    typeof window === "undefined"
      ? null
      : window.localStorage.getItem("studiohub.activeTenantId");
  const membership =
    snapshot.docs.find(
      (document) => document.data().tenantId === preferredTenantId,
    ) ?? snapshot.docs[0];
  if (!membership) throw new Error("No active studio membership was found.");
  return membership;
}
