"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, LoaderCircle, Mail } from "lucide-react";
import { requestBrandedAuthEmail } from "@/lib/auth/email-client";
import { authIsLive } from "@/lib/runtime-mode";

export function ForgotPasswordForm({
  next = null,
  intent = "studio",
}: {
  next?: string | null;
  intent?: "client" | "studio";
}) {
  const [state, setState] = useState<
    "idle" | "submitting" | "sent" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    setMessage("");
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    if (!authIsLive) {
      setState("sent");
      setMessage(
        "Development preview: the branded reset request was validated, but no email was sent.",
      );
      return;
    }
    try {
      await requestBrandedAuthEmail({
        type: "passwordReset",
        idempotencyKey: crypto.randomUUID(),
        input: { email, next },
      });
      setState("sent");
      setMessage(
        "If an account uses that email, a secure StudioCue reset link is on its way.",
      );
    } catch {
      setState("error");
      setMessage(
        "We couldn’t start the password reset. Please wait a moment and try again.",
      );
    }
  }

  if (state === "sent") {
    return (
      <div className="auth-completion" role="status">
        <span className="auth-completion-icon">
          <CheckCircle2 aria-hidden="true" />
        </span>
        <h2>Check your inbox</h2>
        <p>{message}</p>
        <p className="auth-security-note">
          For privacy, this confirmation is the same whether or not an account
          exists.
        </p>
        <Link
          className="button button-dark"
          href={
            next
              ? `/auth/login?next=${encodeURIComponent(next)}`
              : "/auth/login"
          }
        >
          Return to sign in
        </Link>
      </div>
    );
  }

  return (
    <form className="sign-in-form" onSubmit={submit}>
      <label>
        Account email
        <span className="input-with-icon">
          <Mail aria-hidden="true" size={17} />
          <input
            autoComplete="email"
            name="email"
            placeholder={
              intent === "client"
                ? "The email that received the invitation"
                : "you@yourstudio.com"
            }
            required
            type="email"
          />
        </span>
      </label>
      {message ? (
        <p className="form-error" role="alert">
          {message}
        </p>
      ) : null}
      <button
        className="button button-dark sign-in-submit"
        disabled={state === "submitting"}
        type="submit"
      >
        {state === "submitting" ? (
          <LoaderCircle className="spin" size={17} />
        ) : (
          "Email reset link"
        )}
      </button>
      <p className="sign-up-copy">
        Remembered your password?{" "}
        <Link
          href={
            next
              ? `/auth/login?next=${encodeURIComponent(next)}`
              : "/auth/login"
          }
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
