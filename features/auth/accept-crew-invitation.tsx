"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Camera, CheckCircle2, LoaderCircle } from "lucide-react";
import { InvitationJoin } from "@/features/auth/invitation-join";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

/**
 * Joining a studio from an invitation, in one page.
 *
 * This used to offer "Sign in to continue" and "Create an account", both
 * pointing at the generic auth pages. Those pages do not know which address
 * was invited, and the accept refuses every address but that one — so a crew
 * member with no account had to work out that they were meant to register,
 * retype the exact address the studio had typed for them, verify it by a
 * second email, come back and refresh. Every one of those steps was a place to
 * fall out, and the first one was a guess.
 *
 * The token now resolves before anyone signs in, so the page can say who
 * invited them and at which address, and take a password inline. The address
 * is fixed, never typed: it is the one thing that must match.
 */
type Preview = {
  kind: "roster" | "assignment";
  studioName: string;
  email: string;
  name: string;
  hasAccount: boolean;
  expired: boolean;
};

export function AcceptCrewInvitation({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [accepted, setAccepted] = useState<Preview["kind"] | null>(null);
  const [assignmentId, setAssignmentId] = useState("");

  useEffect(() => {
    let active = true;
    void call("crewInvitationPreview", { token })
      .then((value) => active && setPreview(value as Preview))
      .catch((caught: unknown) =>
        active
          ? setPreviewError(
              caught instanceof Error
                ? invitationErrorMessage(caught.message)
                : "This invitation could not be opened.",
            )
          : null,
      );
    return () => {
      active = false;
    };
  }, [token]);

  if (previewError)
    return (
      <div className="invite-actions">
        <p className="form-error" role="status">
          {previewError}
        </p>
      </div>
    );

  if (!preview)
    return (
      <div className="invite-actions">
        <LoaderCircle className="spin" />
        <p>Opening your invitation…</p>
      </div>
    );

  if (preview.expired)
    return (
      <div className="invite-actions">
        <p className="form-error">
          This invitation has expired. Ask {preview.studioName} to resend it.
        </p>
      </div>
    );

  if (accepted)
    return (
      <div className="invite-actions">
        <CheckCircle2 />
        <p>
          {accepted === "roster"
            ? `You're on ${preview.studioName}'s crew. Add your specialties, the dates you're free, and your documents so you're ready when they offer you a job.`
            : "The assignment is now available in your crew workspace."}
        </p>
        <Link
          className="button button-dark"
          href={
            accepted === "roster"
              ? "/crew/profile"
              : `/crew/jobs${assignmentId ? `?assignment=${encodeURIComponent(assignmentId)}` : ""}`
          }
        >
          {accepted === "roster" ? "Set up your profile" : "Review assignment"}
        </Link>
      </div>
    );

  return (
    <InvitationJoin
      intro={
        <p>
          <Camera />
          <strong>{preview.studioName}</strong>
          {preview.kind === "roster"
            ? " added you to their crew."
            : " has an assignment for you."}
        </p>
      }
      onAccept={async () => {
        const result = (await call("crewInvitationCommand", {
          token,
          idempotencyKey: crypto.randomUUID(),
        })) as { assignmentId?: string; kind?: string };
        setAssignmentId(result.assignmentId ?? "");
        setAccepted(result.kind === "roster" ? "roster" : "assignment");
      }}
      preview={preview}
      translateError={invitationErrorMessage}
    />
  );
}

async function call(functionName: string, body: Record<string, unknown>) {
  const endpoint = process.env.NEXT_PUBLIC_CREW_FUNCTIONS_URL;
  if (!endpoint) throw new Error("Crew invitation services are unavailable.");
  const appCheckToken = await getAppCheckToken();
  const user = getFirebaseClient().auth.currentUser;
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/${functionName}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(user ? { authorization: `Bearer ${await user.getIdToken()}` } : {}),
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      },
      body: JSON.stringify(body),
    },
  );
  const result = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(invitationErrorMessage(result.error));
  return result;
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
    case "VERIFIED_EMAIL_REQUIRED":
      return "Your account has no email address on it, so it cannot be matched to this invitation.";
    case "MEMBERSHIP_ROLE_CONFLICT":
      return "This address already works at the studio in another role. Ask them to invite a different address.";
    case "SUBCONTRACTOR_LIMIT_REACHED":
      return "The studio has no crew seats left on its plan. Contact the studio.";
    default:
      return code && !code.includes("_")
        ? code
        : "This could not be opened. Retry once, then ask the studio to resend the invitation.";
  }
}
