"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { getToken } from "firebase/app-check";
import { LoaderCircle } from "lucide-react";
import { getFirebaseClient } from "@/lib/firebase/client";
import { destinationForSignedInUser } from "@/lib/auth/after-sign-in";
import { googleSignInMessage } from "@/features/auth/google-sign-in-errors";

/**
 * "Continue with Google", for sign-in, signup and invitations.
 *
 * Couples and crew too since 2026-09-29: sign-in is passwordless for them
 * (docs/mobile-first-client-crew-plan-2026-09-28.md). An invitation still has
 * to be accepted as the invited address; `onSignedIn` lets it check.
 *
 * Google has already verified the address, so a new owner skips the
 * verification email, the wait and the password: one click, then the studio
 * name (docs/onboarding-assessment-2026-09-26.md, item 6). A new account has
 * no membership, so it lands on onboarding like any other.
 *
 * A popup, not a redirect: the auth handler lives on firebaseapp.com, and
 * browsers that partition third-party storage lose a redirect's result there.
 *
 * Safari opens a popup only if it opens right away after the click. Firebase
 * waits for two things first: its hidden sign-in frame and an App Check token
 * (a reCAPTCHA round trip). Cold, that took long enough for Safari to block
 * the window, while Chrome, which allows more time, opened it. Both are
 * prepared when the button appears, so the click opens the window at once.
 */
export function GoogleSignIn({
  next,
  onBusy,
  onSignedIn,
}: {
  /** A safe, same-site path to return to — already checked by the form. */
  next: string | null;
  onBusy?: (busy: boolean) => void;
  /**
   * Take over after the popup instead of navigating. An invitation uses this
   * to check the Google account is the invited address before accepting.
   */
  onSignedIn?: (email: string) => Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
      // Creating Auth starts the sign-in frame loading (Firebase does this
      // up front on Safari and mobile), and a cached App Check token means
      // Firebase has nothing to fetch between the click and the popup.
      const { appCheck } = getFirebaseClient();
      if (appCheck) void getToken(appCheck).catch(() => undefined);
    } catch {
      // Not configured here: the click reports it.
    }
  }, []);

  async function start() {
    setBusy(true);
    onBusy?.(true);
    setMessage("");
    try {
      const { auth, firestore } = getFirebaseClient();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const result = await signInWithPopup(auth, provider);
      if (onSignedIn) {
        await onSignedIn(result.user.email ?? "");
        setBusy(false);
        onBusy?.(false);
        return;
      }
      router.push(next ?? (await destinationForSignedInUser(auth, firestore)));
    } catch (caught: unknown) {
      const code =
        typeof caught === "object" && caught !== null && "code" in caught
          ? String((caught as { code: unknown }).code)
          : "";
      setMessage(googleSignInMessage(code));
      setBusy(false);
      onBusy?.(false);
    }
  }

  return (
    <>
      <button
        className="button button-light sign-in-google"
        disabled={busy}
        onClick={() => void start()}
        type="button"
      >
        {busy ? <LoaderCircle className="spin" size={18} /> : <GoogleMark />}
        Continue with Google
      </button>
      {message ? (
        <p className="form-error" role="status">
          {message}
        </p>
      ) : null}
      <p className="sign-in-divider" aria-hidden="true">
        <span>or with email</span>
      </p>
    </>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" height="18" viewBox="0 0 48 48" width="18">
      <path
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
        fill="#FFC107"
      />
      <path
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
        fill="#FF3D00"
      />
      <path
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
        fill="#4CAF50"
      />
      <path
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
        fill="#1976D2"
      />
    </svg>
  );
}
