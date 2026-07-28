"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { Camera, CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { authIsLive } from "@/lib/runtime-mode";

export function AcceptCrewInvitation({ token }: { token: string }) {
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
      const endpoint = process.env.NEXT_PUBLIC_CREW_FUNCTIONS_URL;
      const { auth } = getFirebaseClient();
      const user = auth.currentUser;
      if (!endpoint || !user)
        throw new Error("Crew invitation services are unavailable.");
      const appCheckToken = await getAppCheckToken();
      const response = await fetch(
        `${endpoint.replace(/\/$/, "")}/crewInvitationCommand`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${await user.getIdToken()}`,
            ...(appCheckToken
              ? { "x-firebase-appcheck": appCheckToken }
              : {}),
          },
          body: JSON.stringify({
            token,
            idempotencyKey: crypto.randomUUID(),
          }),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? "Crew invitation acceptance failed.");
      setState("accepted");
      setMessage("The assignment is now available in your crew workspace.");
    } catch (caught: unknown) {
      setState("error");
      setMessage(
        caught instanceof Error
          ? caught.message
          : "Crew invitation acceptance failed.",
      );
    }
  }

  const next = `/auth/crew-invite?token=${encodeURIComponent(token)}`;
  if (!signedIn) {
    return (
      <div className="invite-actions">
        <p>
          Sign in with the exact email address that received this assignment.
        </p>
        <Link
          className="button button-dark"
          href={`/auth/login?next=${encodeURIComponent(next)}`}
        >
          Sign in to continue
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
        <p>Verify your email before opening assignment details.</p>
      </div>
    );
  }
  if (state === "accepted") {
    return (
      <div className="invite-actions">
        <CheckCircle2 />
        <p>{message}</p>
        <Link className="button button-dark" href="/crew/pending">
          Review assignment
        </Link>
      </div>
    );
  }
  return (
    <div className="invite-actions">
      <Camera />
      <p>
        This links only the invited assignment and its project-scoped brief to
        your verified account. You can accept or decline after reviewing it.
      </p>
      <button
        className="button button-dark"
        disabled={state === "submitting"}
        onClick={() => void accept()}
        type="button"
      >
        {state === "submitting" ? (
          <LoaderCircle className="spin" />
        ) : (
          <ShieldCheck />
        )}
        Open secure assignment
      </button>
      {message ? (
        <p className="form-error" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
