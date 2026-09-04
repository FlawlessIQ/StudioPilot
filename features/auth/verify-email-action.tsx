"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { applyActionCode } from "firebase/auth";
import { CheckCircle2, LoaderCircle, ShieldAlert } from "lucide-react";
import { getFirebaseClient } from "@/lib/firebase/client";
import { authIsLive } from "@/lib/runtime-mode";

export function VerifyEmailAction({
  oobCode,
  next,
}: {
  oobCode: string;
  next: string | null;
}) {
  const [state, setState] = useState<
    "checking" | "complete" | "invalid"
  >(authIsLive ? "checking" : "complete");

  useEffect(() => {
    if (!authIsLive) return;
    if (!oobCode) {
      queueMicrotask(() => setState("invalid"));
      return;
    }
    let active = true;
    void applyActionCode(getFirebaseClient().auth, oobCode)
      .then(() => {
        if (active) setState("complete");
      })
      .catch(() => {
        if (active) setState("invalid");
      });
    return () => {
      active = false;
    };
  }, [oobCode]);

  if (state === "checking") {
    return (
      <div className="auth-completion" role="status">
        <LoaderCircle className="spin" />
        <h2>Verifying your email</h2>
        <p>This only takes a moment.</p>
      </div>
    );
  }
  if (state === "invalid") {
    return (
      <div className="auth-completion" role="alert">
        <span className="auth-completion-icon auth-completion-warning">
          <ShieldAlert />
        </span>
        <h2>This verification link is no longer valid</h2>
        <p>Sign in to request a new verification message.</p>
        <Link className="button button-dark" href="/auth/login">
          Return to sign in
        </Link>
      </div>
    );
  }
  // P5: honour the link's own continueUrl (`next`) — for a new studio owner
  // that is /auth/onboarding, so verifying carries them straight on instead of
  // detouring through sign-in. Its own guard handles auth if the session has
  // lapsed. Only fall back to sign-in when there is no safe next.
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : null;
  const destination = safeNext ?? "/auth/login?verified=1";
  return (
    <div className="auth-completion" role="status">
      <span className="auth-completion-icon">
        <CheckCircle2 />
      </span>
      <h2>Email verified</h2>
      {/* P5: no assumption that the account was invited — a new owner was not. */}
      <p>Your email is confirmed. Continue to finish setting up your studio.</p>
      <Link className="button button-dark" href={destination}>
        Continue
      </Link>
    </div>
  );
}
