"use client";

import {
  collection,
  getDocs,
  limit,
  query,
  where,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { withTimeout } from "@/lib/async/with-timeout";

const membershipCacheTtlMs = 60_000;
const membershipRequestTimeoutMs = 12_000;

type MembershipCacheEntry = {
  expiresAt: number;
  documents: QueryDocumentSnapshot<DocumentData>[];
};

const membershipCache = new Map<string, MembershipCacheEntry>();
const membershipRequests = new Map<
  string,
  Promise<QueryDocumentSnapshot<DocumentData>[]>
>();

export async function loadMembershipDocuments(
  firestore: Firestore,
  userId: string,
  options: { force?: boolean } = {},
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const cached = membershipCache.get(userId);
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    return cached.documents;
  }
  if (!options.force) {
    const pending = membershipRequests.get(userId);
    if (pending) return pending;
  }

  const request = withTimeout(
    getDocs(
      query(
        collection(firestore, "memberships"),
        where("userId", "==", userId),
        where("status", "==", "active"),
        limit(20),
      ),
    ).then((snapshot) => snapshot.docs),
    membershipRequestTimeoutMs,
    "StudioCue could not verify workspace access in time. Check your connection and try again.",
  )
    .then((documents) => {
      membershipCache.set(userId, {
        documents,
        expiresAt: Date.now() + membershipCacheTtlMs,
      });
      return documents;
    })
    .finally(() => {
      membershipRequests.delete(userId);
    });

  membershipRequests.set(userId, request);
  return request;
}

export function invalidateMembershipCache(userId?: string): void {
  if (userId) {
    membershipCache.delete(userId);
    membershipRequests.delete(userId);
    return;
  }
  membershipCache.clear();
  membershipRequests.clear();
}
