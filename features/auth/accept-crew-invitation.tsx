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
  // A roster invitation carries no job. Same token, same page, different
  // destination: the assignment brief, or the profile they now need to fill in.
  const [isRoster, setIsRoster] = useState(false);
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
        kind?: string;
      };
      if (!response.ok)
        throw new Error(invitationErrorMessage(result.error));
      const roster = result.kind === "roster";
      setIsRoster(roster);
      setAssignmentId(result.assignmentId ?? "");
      setState("accepted");
      setMessage(
        roster
          ? "You're set up. Add your specialties, availability and documents so you're ready when a job is offered."
          : "The assignment is now available in your crew workspace.",
      );
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
        <p>Verify your email before continuing. Then return to this tab and refresh.</p>
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
        <Link
          className="button button-dark"
          href={
            isRoster
              ? "/crew/profile"
              : `/crew/jobs${assignmentId ? `?assignment=${encodeURIComponent(assignmentId)}` : ""}`
          }
        >
          {isRoster ? "Set up your profile" : "Review assignment"}
        </Link>
      </div>
    );
  }
  return (
    <div className="invite-actions">
      <Camera />
      <p>
        This links the studio&rsquo;s invitation to your verified account.
        Access stays scoped to what they invite you to, and the studio can
        revoke it at any time.
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
        Continue securely
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
      return "This invitation has expired. Ask the studio to resend it so you receive a new secure link.";
    case "INVITED_EMAIL_MISMATCH":
      return "This link belongs to a different email address. Sign out and use the exact address the studio invited.";
    case "INVITATION_ALREADY_USED":
      return "This invitation is already linked to another account. Ask the studio to check the email on file, then resend.";
    case "INVITATION_NOT_FOUND":
      return "This link is no longer valid. Ask the studio to resend it.";
    case "SUBCONTRACTOR_LIMIT_REACHED":
      return "The studio has no crew seats left on its plan. Contact the studio.";
    default:
      return code && !code.includes("_")
        ? code
        : "This could not be opened. Retry once, then ask the studio to resend the invitation.";
  }
}
