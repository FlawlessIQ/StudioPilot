"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  ShieldAlert,
} from "lucide-react";
import {
  confirmPasswordReset,
  verifyPasswordResetCode,
} from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase/client";
import { authIsLive } from "@/lib/runtime-mode";

type ResetState =
  | "checking"
  | "ready"
  | "submitting"
  | "complete"
  | "invalid";

export function ResetPasswordForm({
  oobCode,
  next = null,
}: {
  oobCode: string;
  next?: string | null;
}) {
  const [state, setState] = useState<ResetState>(
    authIsLive ? "checking" : "ready",
  );
  const [accountEmail, setAccountEmail] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!authIsLive) return;
    if (!oobCode) {
      queueMicrotask(() => setState("invalid"));
      return;
    }
    let active = true;
    void verifyPasswordResetCode(getFirebaseClient().auth, oobCode)
      .then((email) => {
        if (!active) return;
        setAccountEmail(email);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("invalid");
      });
    return () => {
      active = false;
    };
  }, [oobCode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (password.length < 12) {
      setMessage("Use at least 12 characters.");
      return;
    }
    if (password !== confirmation) {
      setMessage("The passwords do not match.");
      return;
    }
    setState("submitting");
    setMessage("");
    if (!authIsLive) {
      setState("complete");
      return;
    }
    try {
      await confirmPasswordReset(
        getFirebaseClient().auth,
        oobCode,
        password,
      );
      setState("complete");
    } catch {
      setState("invalid");
    }
  }

  if (state === "checking") {
    return (
      <div className="auth-completion" role="status">
        <LoaderCircle className="spin" />
        <h2>Checking your secure link</h2>
        <p>This only takes a moment.</p>
      </div>
    );
  }
  if (state === "invalid") {
    return (
      <div className="auth-completion" role="alert">
        <span className="auth-completion-icon auth-completion-warning">
          <ShieldAlert />
        </span>
        <h2>This link is no longer valid</h2>
        <p>Reset links expire and can only be used once.</p>
        <Link
          className="button button-dark"
          href={
            next
              ? `/auth/forgot-password?next=${encodeURIComponent(next)}`
              : "/auth/forgot-password"
          }
        >
          Request a new link
        </Link>
      </div>
    );
  }
  if (state === "complete") {
    return (
      <div className="auth-completion" role="status">
        <span className="auth-completion-icon">
          <CheckCircle2 />
        </span>
        <h2>Password updated</h2>
        <p>Your new password is ready to use.</p>
        <Link
          className="button button-dark"
          href={
            next
              ? `/auth/login?next=${encodeURIComponent(next)}`
              : "/auth/login"
          }
        >
          {next ? "Return to my invitation" : "Sign in to StudioCue"}
        </Link>
      </div>
    );
  }
  return (
    <form className="sign-in-form" onSubmit={submit}>
      {accountEmail ? (
        <p className="auth-account-email">
          Resetting the account for <strong>{accountEmail}</strong>
        </p>
      ) : null}
      <label>
        New password
        <span className="input-with-icon">
          <KeyRound aria-hidden="true" size={17} />
          <input
            autoComplete="new-password"
            minLength={12}
            name="password"
            placeholder="At least 12 characters"
            required
            type="password"
          />
        </span>
      </label>
      <label>
        Confirm new password
        <input
          autoComplete="new-password"
          minLength={12}
          name="confirmation"
          required
          type="password"
        />
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
          "Save new password"
        )}
      </button>
    </form>
  );
}
