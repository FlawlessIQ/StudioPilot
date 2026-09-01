"use client";

import { useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import Link from "next/link";
import {
  Camera,
  CheckCircle2,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { authIsLive } from "@/lib/runtime-mode";

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
  const [identity, setIdentity] = useState<string | null | undefined>(
    authIsLive ? undefined : null,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [accepted, setAccepted] = useState<Preview["kind"] | null>(null);
  const [assignmentId, setAssignmentId] = useState("");

  useEffect(() => {
    if (!authIsLive) return;
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, (user) =>
      setIdentity(user?.email ? user.email.toLowerCase() : null),
    );
  }, []);

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

  async function accept() {
    const result = (await call("crewInvitationCommand", {
      token,
      idempotencyKey: crypto.randomUUID(),
    })) as { assignmentId?: string; kind?: string };
    setAssignmentId(result.assignmentId ?? "");
    setAccepted(result.kind === "roster" ? "roster" : "assignment");
  }

  async function join(values: FormData) {
    if (!preview) return;
    setBusy(true);
    setMessage("");
    try {
      const { auth } = getFirebaseClient();
      const password = String(values.get("password") ?? "");
      if (!auth.currentUser) {
        // The address comes from the invitation, never from the form, so the
        // account is created against exactly the one the accept will demand.
        if (preview.hasAccount)
          await signInWithEmailAndPassword(auth, preview.email, password);
        else await createUserWithEmailAndPassword(auth, preview.email, password);
      }
      await accept();
    } catch (caught: unknown) {
      setMessage(authMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (previewError)
    return (
      <div className="invite-actions">
        <p className="form-error" role="status">
          {previewError}
        </p>
      </div>
    );

  if (!preview || identity === undefined)
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

  // Signed in as somebody else. The accept would refuse this, so say why here
  // rather than after they have committed to it.
  if (identity && identity !== preview.email)
    return (
      <div className="invite-actions">
        <ShieldCheck />
        <p>
          This invitation is for <strong>{preview.email}</strong>, but
          you&rsquo;re signed in as <strong>{identity}</strong>.
        </p>
        <button
          className="button button-dark"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void signOut(getFirebaseClient().auth).finally(() =>
              setBusy(false),
            );
          }}
          type="button"
        >
          Sign out and continue as {preview.email}
        </button>
      </div>
    );

  return (
    <form
      className="invite-actions"
      onSubmit={(event) => {
        event.preventDefault();
        void join(new FormData(event.currentTarget));
      }}
    >
      <Camera />
      <p>
        <strong>{preview.studioName}</strong>
        {preview.kind === "roster"
          ? " added you to their crew."
          : " has an assignment for you."}{" "}
        Joining as <strong>{preview.email}</strong>.
      </p>
      {identity ? null : (
        <label>
          {preview.hasAccount ? "Your password" : "Choose a password"}
          <input
            autoComplete={preview.hasAccount ? "current-password" : "new-password"}
            minLength={preview.hasAccount ? undefined : 12}
            name="password"
            required
            type="password"
          />
          {preview.hasAccount ? null : <small>At least 12 characters.</small>}
        </label>
      )}
      <button className="button button-dark" disabled={busy} type="submit">
        {busy ? <LoaderCircle className="spin" /> : <ShieldCheck />}
        {identity
          ? "Accept invitation"
          : preview.hasAccount
            ? "Sign in and accept"
            : "Create account and accept"}
      </button>
      {preview.hasAccount && !identity ? (
        <Link href={`/auth/forgot-password?email=${encodeURIComponent(preview.email)}`}>
          Forgot your password?
        </Link>
      ) : null}
      {message ? (
        <p className="form-error" role="status">
          {message}
        </p>
      ) : null}
    </form>
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

function authMessage(caught: unknown) {
  const code =
    typeof caught === "object" && caught && "code" in caught
      ? String((caught as { code: unknown }).code)
      : "";
  switch (code) {
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "That password is not right. Try again, or reset it below.";
    case "auth/weak-password":
      return "Choose a longer password — at least 12 characters.";
    case "auth/email-already-in-use":
      return "An account already exists for this address. Reload the page and sign in instead.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a few minutes and try again.";
    default:
      return caught instanceof Error
        ? caught.message
        : "This invitation could not be accepted.";
  }
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
