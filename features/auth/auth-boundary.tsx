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
            router.replace("/auth/login");
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
          const memberships = await loadMembershipDocuments(
            firestore,
            user.uid,
            { force: attempt > 0 },
          );
          const permitted = memberships.some((document) =>
            allowed[area].includes(String(document.data().role)),
          );
          if (!permitted) {
            const roles = memberships.map((document) =>
              String(document.data().role),
            );
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
    <main className="auth-loading auth-loading-error" role="alert">
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
    <main className="auth-loading" aria-live="polite">
      <span className="auth-loading-spinner" aria-hidden="true" />
      <strong>Opening your workspace</strong>
      <span>Checking your secure studio access…</span>
    </main>
  );
}
export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  async function leave() {
    if (authIsLive) {
      const { auth } = getFirebaseClient();
      if (auth.currentUser) invalidateMembershipCache(auth.currentUser.uid);
      await signOut(auth);
    }
    router.push("/auth/login");
  }
  return (
    <button className={className} type="button" onClick={() => void leave()}>
      Sign out
    </button>
  );
}
