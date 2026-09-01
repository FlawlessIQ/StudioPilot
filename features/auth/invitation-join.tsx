"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import Link from "next/link";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { getFirebaseClient } from "@/lib/firebase/client";
import { authIsLive } from "@/lib/runtime-mode";

/**
 * Joining from an invitation, for all three kinds.
 *
 * Staff, client and crew invitations each sent people to `/auth/login` or
 * `/auth/register`. Those pages do not know which address was invited, and
 * every accept refuses all but that one — so somebody arriving by invitation,
 * which is the only way any of them arrive, had to work out that they were
 * meant to register rather than sign in, retype the exact address someone else
 * had typed for them, verify it by a second email, come back and refresh. Four
 * places to fall out, and the first was a guess.
 *
 * One component because it was one bug three times, and three fixes would
 * drift. The address is displayed, never typed: it is the single thing that
 * has to match, so it comes from the invitation rather than the keyboard.
 */
export type InvitationJoinPreview = {
  studioName: string;
  email: string;
  hasAccount: boolean;
};

export function InvitationJoin({
  preview,
  intro,
  onAccept,
  translateError,
}: {
  preview: InvitationJoinPreview;
  intro: ReactNode;
  onAccept: () => Promise<void>;
  translateError?: (code: string) => string;
}) {
  const [identity, setIdentity] = useState<string | null | undefined>(
    authIsLive ? undefined : null,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!authIsLive) return;
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, (user) =>
      setIdentity(user?.email ? user.email.toLowerCase() : null),
    );
  }, []);

  const invited = preview.email.trim().toLowerCase();

  async function join(values: FormData) {
    setBusy(true);
    setMessage("");
    try {
      const { auth } = getFirebaseClient();
      if (!auth.currentUser) {
        const password = String(values.get("password") ?? "");
        // Against the invited address, never a typed one, so the account is
        // created as exactly the identity the accept will demand.
        if (preview.hasAccount)
          await signInWithEmailAndPassword(auth, invited, password);
        else await createUserWithEmailAndPassword(auth, invited, password);
      }
      await onAccept();
    } catch (caught: unknown) {
      setMessage(authMessage(caught, translateError));
    } finally {
      setBusy(false);
    }
  }

  if (identity === undefined)
    return (
      <div className="invite-actions">
        <LoaderCircle className="spin" />
        <p>Checking your session…</p>
      </div>
    );

  // The accept would refuse this. Say so here, with the way out, rather than
  // after they have committed to it.
  if (identity && identity !== invited)
    return (
      <div className="invite-actions">
        <ShieldCheck />
        <p>
          This invitation is for <strong>{invited}</strong>, but you&rsquo;re
          signed in as <strong>{identity}</strong>.
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
          Sign out and continue as {invited}
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
      {intro}
      <p>
        Joining as <strong>{invited}</strong>.
      </p>
      {identity ? null : (
        <label>
          {preview.hasAccount ? "Your password" : "Choose a password"}
          <input
            autoComplete={
              preview.hasAccount ? "current-password" : "new-password"
            }
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
        <Link href={`/auth/forgot-password?email=${encodeURIComponent(invited)}`}>
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

/** Firebase auth codes, then whatever the caller's endpoint said. */
function authMessage(caught: unknown, translate?: (code: string) => string) {
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
      break;
  }
  const raw = caught instanceof Error ? caught.message : "";
  if (raw && translate) return translate(raw);
  return raw || "This invitation could not be accepted.";
}
