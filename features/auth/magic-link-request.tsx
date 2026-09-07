"use client";

import { useState } from "react";
import { LoaderCircle, Mail } from "lucide-react";
import { requestBrandedAuthEmail } from "@/lib/auth/email-client";

/**
 * "Email me a sign-in link" — passwordless portal access (P19).
 *
 * Dark until NEXT_PUBLIC_CLIENT_MAGIC_LINK === "1" AND the Email-link sign-in
 * method is enabled in the Firebase console, so it never shows a button that
 * would fail. The address is stored locally so the /auth/email-link landing can
 * complete sign-in without re-asking on the same device; the response is
 * deliberately identical whether or not an account exists (no enumeration).
 */
const STORAGE_KEY = "studiohub.emailLinkAddress";

export function MagicLinkRequest({ next }: { next?: string | null }) {
  const enabled = process.env.NEXT_PUBLIC_CLIENT_MAGIC_LINK === "1";
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!enabled) return null;

  async function send() {
    const address = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      setError("Enter your email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      try {
        window.localStorage.setItem(STORAGE_KEY, address);
      } catch {
        // Storage disabled — the landing will ask for the address instead.
      }
      await requestBrandedAuthEmail({
        type: "signInLink",
        idempotencyKey: crypto.randomUUID(),
        input: { email: address, next: next ?? "/client" },
      });
      setSent(true);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The sign-in link could not be sent.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <p className="auth-magic-sent" role="status">
        If an account exists for {email}, a sign-in link is on its way. Open it
        on this device to continue.
      </p>
    );

  return (
    <div className="auth-magic-link">
      <div className="auth-divider">
        <span>or</span>
      </div>
      <label>
        Email me a sign-in link
        <input
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          type="email"
          value={email}
        />
      </label>
      <button
        className="button button-light"
        disabled={busy}
        onClick={() => void send()}
        type="button"
      >
        {busy ? <LoaderCircle className="spin" size={15} /> : <Mail size={15} />}{" "}
        Email me a link
      </button>
      {error ? (
        <p className="form-error" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}
