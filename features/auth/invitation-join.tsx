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
import { GoogleSignIn } from "@/features/auth/google-sign-in";

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
  verb = "accept",
}: {
  preview: InvitationJoinPreview;
  intro: ReactNode;
  onAccept: () => Promise<void>;
  translateError?: (code: string) => string;
  /**
   * What pressing the button actually does, in the caller's own terms.
   *
   * A crew invitation does not accept the job — it claims the invitation and
   * opens the assignment for review, as its own confirmation says ("The
   * assignment is now available in your crew workspace", button "Review
   * assignment"). The shared label said "accept" anyway, so the first thing a
   * subcontractor ever sees asks them to accept a paid Saturday they have not
   * been shown, and contradicts the screen that follows. Defaults to the
   * original wording for the invitations where accepting is what happens.
   */
  verb?: string;
}) {
  // This very page, token and all: where a password reset should return to.
  const returnTo =
    typeof window === "undefined"
      ? ""
      : `${window.location.pathname}${window.location.search}`;
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
      <p className="kit-body" role="status">
        <LoaderCircle aria-hidden="true" className="spin" size={18} /> Checking your session…
      </p>
    );

  // The accept would refuse this. Say so here, with the way out, rather than
  // after they have committed to it.
  if (identity && identity !== invited)
    return (
      <div className="kit-stack">
        <p className="kit-note" data-tone="danger">
          <ShieldCheck aria-hidden="true" size={18} />
          <span>
            This invitation is for <strong>{invited}</strong>, but you&rsquo;re
            signed in as <strong>{identity}</strong>.
          </span>
        </p>
        <button
          className="kit-button"
          data-variant="dark"
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

  // Kit markup (docs/mobile-first-client-crew-plan-2026-09-28.md, M2): the
  // page around this provides the `.kit` root and the studio's colour.
  return (
    <form
      className="kit-stack"
      onSubmit={(event) => {
        event.preventDefault();
        void join(new FormData(event.currentTarget));
      }}
    >
      <div className="kit-body">{intro}</div>
      <p className="kit-body">
        Joining as <strong>{invited}</strong>.
      </p>
      {/* No password to invent: Google has already verified the address, and
          the accept demands the invited one, so a different Google account
          is turned back here, before anything is committed. */}
      {!identity && authIsLive ? (
        <GoogleSignIn
          next={null}
          onSignedIn={async (email) => {
            if (email.trim().toLowerCase() !== invited) {
              await signOut(getFirebaseClient().auth);
              setMessage(
                `That Google account is ${email || "a different address"}. This invitation is for ${invited}: choose that account, or use a password below.`,
              );
              return;
            }
            setBusy(true);
            try {
              await onAccept();
            } catch (caught: unknown) {
              setMessage(authMessage(caught, translateError));
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
      {identity ? null : (
        <label className="kit-field">
          <span className="kit-field-label">
            {preview.hasAccount ? "Your password" : "Choose a password"}
          </span>
          <input
            autoComplete={
              preview.hasAccount ? "current-password" : "new-password"
            }
            className="kit-input"
            minLength={preview.hasAccount ? undefined : 12}
            name="password"
            required
            type="password"
          />
          {preview.hasAccount ? null : <span className="kit-hint">At least 12 characters.</span>}
        </label>
      )}
      <button className="kit-button" disabled={busy} type="submit">
        {busy ? <LoaderCircle aria-hidden="true" className="spin" size={18} /> : <ShieldCheck aria-hidden="true" size={18} />}
        {identity
          ? verb === "accept"
            ? "Accept invitation"
            : `Continue to ${verb}`
          : preview.hasAccount
            ? `Sign in and ${verb}`
            : `Create account and ${verb}`}
      </button>
      {preview.hasAccount && !identity ? (
        <Link
          className="kit-caption"
          href={`/auth/forgot-password?email=${encodeURIComponent(invited)}${
            // Carry the invitation along, so the reset lands them back on it.
            // Without this the round trip ends on a generic sign-in page and
            // the invitation has to be dug out of the inbox again — which is
            // exactly where a crew member goes when they don't remember
            // setting a password.
            returnTo ? `&next=${encodeURIComponent(returnTo)}` : ""
          }`}
          style={{ textAlign: "center" }}
        >
          Forgot your password?
        </Link>
      ) : null}
      {message ? (
        <p className="kit-error" role="status">
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
