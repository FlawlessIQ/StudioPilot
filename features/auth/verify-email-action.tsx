"use client";

import { useEffect, useRef, useState } from "react";
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
  /**
   * One code, applied once.
   *
   * The effect ran twice on one page (React's development double run, and any
   * second mount), and a code can only be applied once: the first call
   * verified the address and the second, refused, set "no longer valid" — so
   * the owner was told the link had failed by the visit that had just
   * verified them (onboarding audit, 2026-10-24).
   */
  const applied = useRef<string | null>(null);

  useEffect(() => {
    if (!authIsLive) return;
    if (!oobCode) {
      queueMicrotask(() => setState("invalid"));
      return;
    }
    if (applied.current === oobCode) return;
    applied.current = oobCode;
    const { auth } = getFirebaseClient();
    void applyActionCode(auth, oobCode)
      .then(() => setState("complete"))
      .catch(async () => {
        // Already used is not the same as failed. Work mail scanners open
        // links before the owner does, and a second tap reuses the code: if
        // the account signed in here is verified, it is verified.
        await auth.authStateReady().catch(() => undefined);
        const user = auth.currentUser;
        if (user) {
          await user.reload().catch(() => undefined);
          if (user.emailVerified) {
            setState("complete");
            return;
          }
        }
        setState("invalid");
      });
  }, [oobCode]);

  // P5: honour the link's own continueUrl (`next`) — for a new studio owner
  // that is /auth/onboarding, so verifying carries them straight on instead of
  // detouring through sign-in. Its own guard handles auth if the session has
  // lapsed. Only fall back to sign-in when there is no safe next.
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : null;

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
        <h2>This link has already been used or has expired</h2>
        {/* It said only "no longer valid", to an owner who had often just
            verified — on another device, or by a mail scanner's visit. */}
        <p>
          If you opened it before, your email may already be verified. Sign in to carry on; if it
          still needs verifying, you can send yourself a fresh link from there.
        </p>
        <Link
          className="button button-dark"
          href={safeNext ? `/auth/login?next=${encodeURIComponent(safeNext)}` : "/auth/login"}
        >
          Sign in to continue
        </Link>
      </div>
    );
  }
  const destination = safeNext ?? "/auth/login?verified=1";
  return (
    <div className="auth-completion" role="status">
      <span className="auth-completion-icon">
        <CheckCircle2 />
      </span>
      <h2>Email verified</h2>
      {/* P5: no assumption that the account was invited — a new owner was not.
          A new owner often signs up on a laptop and taps the link on a phone:
          the laptop's "Check your email" page moves on by itself. */}
      <p>
        {safeNext === "/auth/onboarding"
          ? "Your email is confirmed. Continue here to set up your studio, or go back to where you signed up — that page moves on by itself."
          : "Your email is confirmed. Continue to pick up where you left off."}
      </p>
      <Link className="button button-dark" href={destination}>
        Continue
      </Link>
    </div>
  );
}
