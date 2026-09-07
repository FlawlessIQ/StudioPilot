"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { isSignInWithEmailLink, signInWithEmailLink } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase/client";
import { authIsLive } from "@/lib/runtime-mode";

/**
 * Complete a passwordless sign-in link (P19).
 *
 * The link was minted server-side and emailed via the branded, tracking-free
 * auth path, so — unlike the Firebase SDK's own send flow — this device has no
 * stored address to match. If one happens to be stored (the requester used the
 * same browser), we use it; otherwise we ask the person to confirm the address
 * the link was sent to, which `signInWithEmailLink` requires and which keeps a
 * forwarded link from signing in the wrong person.
 */
const STORAGE_KEY = "studiohub.emailLinkAddress";

export function EmailLinkAction({ next }: { next: string | null }) {
  const [phase, setPhase] = useState<
    "checking" | "need_email" | "signing_in" | "done" | "error" | "invalid"
  >("checking");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const destination =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/client";

  async function complete(address: string) {
    setPhase("signing_in");
    setMessage("");
    try {
      const { auth } = getFirebaseClient();
      await signInWithEmailLink(auth, address, window.location.href);
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // A private window with storage disabled is fine — nothing to clear.
      }
      setPhase("done");
      window.location.assign(destination);
    } catch (caught: unknown) {
      setMessage(
        caught instanceof Error
          ? "That didn't work. The link may have expired or already been used — request a new one."
          : "This sign-in link could not be used.",
      );
      setPhase("error");
    }
  }

  useEffect(() => {
    let active = true;
    const settle = (fn: () => void) =>
      queueMicrotask(() => {
        if (active) fn();
      });
    if (!authIsLive) {
      settle(() => setPhase("invalid"));
      return () => {
        active = false;
      };
    }
    const { auth } = getFirebaseClient();
    if (!isSignInWithEmailLink(auth, window.location.href)) {
      settle(() => setPhase("invalid"));
      return () => {
        active = false;
      };
    }
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    settle(() =>
      stored ? void complete(stored) : setPhase("need_email"),
    );
    return () => {
      active = false;
    };
    // Run once on mount; complete() reads the live URL itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === "checking" || phase === "signing_in" || phase === "done")
    return (
      <div className="invite-actions">
        <LoaderCircle className="spin" />
        <p>{phase === "done" ? "Opening your portal…" : "Signing you in…"}</p>
      </div>
    );

  if (phase === "invalid")
    return (
      <div className="invite-actions">
        <p>
          This sign-in link is invalid or has expired. Request a new one from
          your portal sign-in.
        </p>
      </div>
    );

  return (
    <form
      className="invite-actions"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void complete(email.trim().toLowerCase());
      }}
    >
      <p>Confirm the email address this link was sent to.</p>
      <label>
        Email
        <input
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <button className="button button-dark" type="submit">
        <ShieldCheck /> Sign in
      </button>
      {message ? (
        <p className="form-error" role="status">
          {message}
        </p>
      ) : null}
    </form>
  );
}
