"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { getFirebaseClient } from "@/lib/firebase/client";
import { authIsLive } from "@/lib/runtime-mode";
import { destinationForSignedInUser } from "@/lib/auth/after-sign-in";
import { GoogleSignIn } from "@/features/auth/google-sign-in";

type FormState = {
  status: "idle" | "submitting" | "error";
  message: string;
};

export function SignInForm({
  next,
  intent = "studio",
}: {
  next?: string;
  intent?: "client" | "crew" | "studio";
}) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  // A client arriving from an invitation gets the address the invitation is
  // for, stashed by the invite page before the sign-out → login round-trip
  // (audit-2 N2). Without this the field starts empty and the browser autofills
  // whatever account was last used here — typically the studio the couple just
  // got bounced out of. Studio sign-in keeps its empty default.
  const [email, setEmail] = useState(() => {
    if (intent !== "client" || typeof window === "undefined") return "";
    try {
      return window.sessionStorage.getItem("studiohub.invitedEmail") ?? "";
    } catch {
      return "";
    }
  });
  const [password, setPassword] = useState("");
  const [formState, setFormState] = useState<FormState>({
    status: "idle",
    message: "",
  });

  const mockMode = !authIsLive;
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : null;
  const forgotPasswordHref = safeNext
    ? `/auth/forgot-password?next=${encodeURIComponent(safeNext)}`
    : "/auth/forgot-password";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormState({ status: "submitting", message: "" });

    if (mockMode) {
      router.push(safeNext ?? "/studio");
      return;
    }

    try {
      const { auth,firestore } = getFirebaseClient();
      await signInWithEmailAndPassword(auth, email, password);
      if (safeNext) {
        router.push(safeNext);
        return;
      }
      router.push(await destinationForSignedInUser(auth, firestore));
    } catch {
      setFormState({
        status: "error",
        message: "We couldn’t sign you in. Check your email and password, then try again.",
      });
    }
  }

  return (
    <form className="sign-in-form" onSubmit={handleSubmit}>
      {/* Everyone, since 2026-09-29: couples and crew sign in without a
          password (Google, or the emailed link below). It used to be studio
          only, so an invited client kept the exact address in front of them;
          the invitation page now checks that for Google itself, and a
          returning client who picks another Google account simply has no
          portal on it and is told so. */}
      {!mockMode ? <GoogleSignIn next={safeNext} /> : null}
      <label>
        Email address
        <input
          required
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={
            intent === "client"
              ? "The email that received the invitation"
              : intent === "crew"
                ? "The email your studio invited"
                : "you@yourstudio.com"
          }
        />
      </label>
      <label>
        <span className="label-row">
          Password{" "}
          <Link href={forgotPasswordHref}>
            Forgot password?
          </Link>
        </span>
        <span className="password-field">
          <input
            required
            minLength={8}
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
          />
          <button
            type="button"
            aria-label={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </span>
      </label>
      {formState.message ? (
        <p className={formState.status === "error" ? "form-error" : "form-success"} role="status">
          {formState.message}
        </p>
      ) : null}
      {mockMode ? (
        <p className="demo-note">
          Local demo mode is active. Use any valid email and an 8-character password.
        </p>
      ) : null}
      <button
        className="button button-dark sign-in-submit"
        type="submit"
        disabled={formState.status === "submitting"}
      >
        {formState.status === "submitting" ? (
          <LoaderCircle size={17} className="spin" />
        ) : (
          <>
            {intent === "client" ? "Open my project" : intent === "crew" ? "Open my workspace" : "Sign in"}{" "}
            <ArrowRight size={17} />
          </>
        )}
      </button>
      {/* Crew join from their invitation, which sets up the account; a trial
          link here was an offer to start a studio. */}
      {intent === "crew" ? (
        <p className="sign-up-copy">First time here? Open the link in your invitation email.</p>
      ) : (
        <p className="sign-up-copy">
          {intent === "client" ? "First time here?" : "New to StudioCue?"}{" "}
          <Link href={safeNext ? `/auth/register?next=${encodeURIComponent(safeNext)}` : "/auth/register"}>
            {intent === "client" ? "Create client access" : "Start a free trial"}
          </Link>
        </p>
      )}
    </form>
  );
}
