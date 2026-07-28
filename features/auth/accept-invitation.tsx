"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import { getFirebaseClient } from "@/lib/firebase/client";
import { runMembershipCommand } from "@/lib/memberships/command-client";
import { authIsLive } from "@/lib/runtime-mode";

export function AcceptInvitation({ token }: { token: string }) {
  const [signedIn, setSignedIn] = useState(!authIsLive);
  const [verified, setVerified] = useState(!authIsLive);
  const [state, setState] = useState<
    "idle" | "submitting" | "accepted" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!authIsLive) return;
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, (user) => {
      setSignedIn(Boolean(user));
      setVerified(Boolean(user?.emailVerified));
    });
  }, []);

  async function accept() {
    setState("submitting");
    setMessage("");
    try {
      await runMembershipCommand({
        type: "acceptInvitation",
        input: { token },
      });
      setState("accepted");
      setMessage("Your workspace access is active.");
    } catch (caught: unknown) {
      setState("error");
      setMessage(
        caught instanceof Error ? caught.message : "Invitation acceptance failed.",
      );
    }
  }

  const next = `/auth/invite?token=${encodeURIComponent(token)}`;
  if (!signedIn) {
    return (
      <div className="invite-actions">
        <p>Sign in with the exact email address that received this invitation.</p>
        <Link className="button button-dark" href={`/auth/login?next=${encodeURIComponent(next)}`}>
          Sign in to accept
        </Link>
        <Link href={`/auth/register?next=${encodeURIComponent(next)}`}>
          Create an account with the invited email
        </Link>
      </div>
    );
  }
  if (!verified) {
    return (
      <div className="invite-actions">
        <ShieldCheck />
        <p>Verify your email address before accepting workspace access.</p>
      </div>
    );
  }
  if (state === "accepted") {
    return (
      <div className="invite-actions">
        <CheckCircle2 />
        <p>{message}</p>
        <Link className="button button-dark" href="/studio">
          Open StudioHub
        </Link>
      </div>
    );
  }
  return (
    <div className="invite-actions">
      <p>
        Acceptance activates only the role selected by the Studio Owner and is
        recorded in the immutable audit log.
      </p>
      <button
        className="button button-dark"
        disabled={state === "submitting" || token.length < 32}
        onClick={() => void accept()}
        type="button"
      >
        {state === "submitting" ? <LoaderCircle className="spin" /> : <ShieldCheck />}
        Accept workspace invitation
      </button>
      {message ? (
        <p className="form-error" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
