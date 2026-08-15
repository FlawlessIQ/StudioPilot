"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged, sendEmailVerification } from "firebase/auth";
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
  const [assignmentId, setAssignmentId] = useState("");
  const [verificationSent, setVerificationSent] = useState(false);

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
      const result = (await response.json()) as {
        error?: string;
        assignmentId?: string;
      };
      if (!response.ok)
        throw new Error(invitationErrorMessage(result.error));
      setAssignmentId(result.assignmentId ?? "");
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
        <p>Verify your email before opening assignment details. Then return to this tab and refresh.</p>
        <button
          className="button button-dark"
          disabled={verificationSent}
          onClick={() => {
            const user = getFirebaseClient().auth.currentUser;
            if (!user) return;
            void sendEmailVerification(user).then(() => setVerificationSent(true));
          }}
          type="button"
        >
          {verificationSent ? "Verification email sent" : "Send verification email"}
        </button>
      </div>
    );
  }
  if (state === "accepted") {
    return (
      <div className="invite-actions">
        <CheckCircle2 />
        <p>{message}</p>
        <Link className="button button-dark" href={`/crew/jobs${assignmentId ? `?assignment=${encodeURIComponent(assignmentId)}` : ""}`}>
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

function invitationErrorMessage(code?: string) {
  switch (code) {
    case "INVITATION_EXPIRED":
      return "This invitation has expired. Ask the studio to resend the assignment so you receive a new secure link.";
    case "INVITED_EMAIL_MISMATCH":
      return "This link belongs to a different email address. Sign out and use the exact address that received the assignment.";
    case "INVITATION_ALREADY_USED":
      return "This invitation is already linked to another account. Ask the studio to verify the crew email or resend the offer.";
    case "INVITATION_NOT_FOUND":
      return "This assignment link is no longer valid. Ask the studio to resend it.";
    case "SUBCONTRACTOR_LIMIT_REACHED":
      return "The studio needs to update its crew access before this assignment can be opened. Contact the studio.";
    default:
      return code && !code.includes("_")
        ? code
        : "The assignment could not be opened. Retry once, then ask the studio to resend the invitation.";
  }
}
