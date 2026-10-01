"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, type DocumentData, type Firestore, type Query } from "firebase/firestore";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";

/**
 * Live reads for the Console. Every list is a listener, so a command's effect
 * shows without a refresh button — the refresh-after-write bug that left
 * studio panels stale can't happen here.
 *
 * Reads are platform-admin reads allowed by firestore.rules. With live data
 * off (mock mode) nothing is read and `offline` says why the page is empty.
 *
 * State is only ever set from a snapshot callback. What a query returned is
 * stored with the key it was for, so a new key reads as loading until its
 * first snapshot arrives, without resetting anything inside the effect.
 */
export type LiveState<T> = {
  rows: T[] | null;
  error: string | null;
  offline: boolean;
};

function withId(id: string, data: DocumentData): Record<string, unknown> {
  return { id, ...data };
}

function describe(caught: unknown): string {
  const code = (caught as { code?: string })?.code ?? "";
  if (code === "permission-denied") return "Your account can't read this. Console access needs the platform admin claim.";
  if (code === "failed-precondition") return "This view needs a database index that isn't deployed yet.";
  return "This list couldn't be loaded. Check your connection and try again.";
}

/**
 * `key` names the query; change it to re-subscribe. A null key reads nothing
 * (a record id not known yet).
 */
export function useLiveQuery<T = Record<string, unknown>>(
  key: string | null,
  build: (firestore: Firestore) => Query | null,
): LiveState<T> {
  const [result, setResult] = useState<{ key: string; rows: T[]; error: string | null } | null>(null);
  useEffect(() => {
    if (!dataIsLive || key === null) return;
    const query = build(getFirebaseClient().firestore);
    if (!query) return;
    return onSnapshot(
      query,
      (snapshot) => setResult({ key, rows: snapshot.docs.map((item) => withId(item.id, item.data()) as T), error: null }),
      (caught) => setResult({ key, rows: [], error: describe(caught) }),
    );
    // `build` is recreated each render; `key` is what identifies the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!dataIsLive) return { rows: [], error: null, offline: true };
  if (key === null || result?.key !== key) return { rows: null, error: null, offline: false };
  return { rows: result.rows, error: result.error, offline: false };
}

export type LiveDoc<T> = { data: T | null; loading: boolean; missing: boolean; error: string | null; offline: boolean };

export function useLiveDoc<T = Record<string, unknown>>(path: string | null): LiveDoc<T> {
  const [result, setResult] = useState<{ path: string; data: T | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!dataIsLive || !path) return;
    return onSnapshot(
      doc(getFirebaseClient().firestore, path),
      (snapshot) => setResult({ path, data: snapshot.exists() ? (withId(snapshot.id, snapshot.data()) as T) : null, error: null }),
      (caught) => setResult({ path, data: null, error: describe(caught) }),
    );
  }, [path]);
  if (!dataIsLive) return { data: null, loading: false, missing: false, error: null, offline: true };
  if (!path) return { data: null, loading: false, missing: true, error: null, offline: false };
  if (result?.path !== path) return { data: null, loading: true, missing: false, error: null, offline: false };
  return { data: result.data, loading: false, missing: !result.data && !result.error, error: result.error, offline: false };
}
