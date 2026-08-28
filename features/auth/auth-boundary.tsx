"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { signOut } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase/client";
import {
  invalidateMembershipCache,
  loadMembershipDocuments,
} from "@/lib/firebase/membership-cache";
import { authIsLive } from "@/lib/runtime-mode";
import { withTimeout } from "@/lib/async/with-timeout";
import { getWorkspaceBootstrap } from "@/lib/firebase/workspace-bootstrap";
type Area = "studio" | "client" | "crew" | "platform";
const allowed: Record<Exclude<Area, "platform">, string[]> = {
  studio: [
    "studio_owner",
    "studio_admin",
    "studio_coordinator",
    "staff_photographer",
  ],
  client: ["client"],
  crew: ["subcontractor"],
};
export function AuthBoundary({
  area,
  children,
}: {
  area: Area;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<
    "checking" | "authorized" | "error"
  >(authIsLive ? "checking" : "authorized");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!authIsLive) return;
    const { auth, firestore } = getFirebaseClient();
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      void (async () => {
        try {
          if (!user) {
            // Carry the destination. A client following "Review proposal"
            // from their email lands here signed out; without `next` they
            // sign in and arrive nowhere near the proposal, which is what
            // the emailed button appeared to do.
            const here = `${window.location.pathname}${window.location.search}`;
            router.replace(
              here && here !== "/"
                ? `/auth/login?next=${encodeURIComponent(here)}`
                : "/auth/login",
            );
            return;
          }
          if (area === "platform") {
            const token = await withTimeout(
              user.getIdTokenResult(attempt > 0),
              12_000,
              "StudioCue could not verify platform access in time.",
            );
            if (token.claims.platformAdmin !== true) {
              router.replace("/studio");
              return;
            }
            if (active) setStatus("authorized");
            return;
          }
          let roles: string[];
          try {
            const memberships = await loadMembershipDocuments(
              firestore,
              user.uid,
              { force: attempt > 0 },
            );
            roles = memberships.map((document) =>
              String(document.data().role),
            );
          } catch {
            const preferredTenantId = window.localStorage.getItem(
              "studiohub.activeTenantId",
            );
            const bootstrap = await getWorkspaceBootstrap(
              area,
              preferredTenantId,
            );
            roles = bootstrap.memberships.map((membership) => membership.role);
          }
          const permitted = roles.some((role) => allowed[area].includes(role));
          if (!permitted) {
            const destination = roles.includes("client")
              ? "/client"
              : roles.includes("subcontractor")
                ? "/crew"
                : roles.some((role) => allowed.studio.includes(role))
                  ? "/studio"
                  : "/auth/onboarding";
            router.replace(destination);
            return;
          }
          if (active) setStatus("authorized");
        } catch (caught: unknown) {
          if (!active) return;
          setMessage(
            caught instanceof Error
              ? caught.message
              : "StudioCue could not verify workspace access.",
          );
          setStatus("error");
        }
      })();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [area, attempt, router]);
  return status === "authorized" ? (
    <>{children}</>
  ) : status === "error" ? (
    <main className="ds-root auth-loading auth-loading-error" data-ds-theme="emerald" role="alert">
      <strong>Workspace access could not be verified</strong>
      <span>{message}</span>
      <button
        className="button button-dark"
        onClick={() => {
          setMessage("");
          setStatus("checking");
          setAttempt((current) => current + 1);
        }}
        type="button"
      >
        Try again
      </button>
    </main>
  ) : (
    <main className="ds-root auth-loading" data-ds-theme="emerald" aria-live="polite">
      <span className="auth-loading-spinner" aria-hidden="true" />
      <strong>Opening your workspace</strong>
      <span>Checking your secure studio access…</span>
    </main>
  );
}
/**
 * Everything this browser remembered about the person who just left.
 *
 * Signing out cleared the Firebase session and nothing else, so a shared or
 * borrowed laptop kept the previous user's workspace pointer *and* their cached
 * event brief — `studiocue:crew-event-brief:<uid>:<assignment>:<version>` holds
 * a subcontractor's call times, venue addresses and contacts so the brief works
 * with no signal at a venue. Useful on their own phone; not something to leave
 * behind on someone else's machine.
 *
 * Prefix-matched rather than enumerated, so a key added later is covered by
 * default instead of being remembered forever by omission.
 */
const REMEMBERED_PREFIXES = ["studiohub.", "studiocue:"];

export function forgetLocalWorkspaceState(): void {
  if (typeof window === "undefined") return;
  for (const store of [window.localStorage, window.sessionStorage]) {
    for (const key of Object.keys(store)) {
      if (REMEMBERED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        store.removeItem(key);
      }
    }
  }
}

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  async function leave() {
    if (authIsLive) {
      const { auth } = getFirebaseClient();
      if (auth.currentUser) invalidateMembershipCache(auth.currentUser.uid);
      await signOut(auth);
    }
    forgetLocalWorkspaceState();
    router.push("/auth/login");
  }
  return (
    <button className={className} type="button" onClick={() => void leave()}>
      Sign out
    </button>
  );
}
