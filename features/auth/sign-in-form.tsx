"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { getFirebaseClient } from "@/lib/firebase/client";

type FormState = {
  status: "idle" | "submitting" | "error";
  message: string;
};

export function SignInForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formState, setFormState] = useState<FormState>({
    status: "idle",
    message: "",
  });

  const mockMode = process.env.NEXT_PUBLIC_INTEGRATION_MODE !== "live";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormState({ status: "submitting", message: "" });

    if (mockMode) {
      router.push("/studio");
      return;
    }

    try {
      const { auth } = getFirebaseClient();
      await signInWithEmailAndPassword(auth, email, password);
      router.push("/studio");
    } catch {
      setFormState({
        status: "error",
        message: "We couldn’t sign you in. Check your email and password, then try again.",
      });
    }
  }

  async function handlePasswordReset() {
    if (!email) {
      setFormState({ status: "error", message: "Enter your email address first." });
      return;
    }

    if (mockMode) {
      setFormState({
        status: "error",
        message: "Password reset is disabled in local demo mode.",
      });
      return;
    }

    try {
      const { auth } = getFirebaseClient();
      await sendPasswordResetEmail(auth, email);
      setFormState({
        status: "idle",
        message: "Check your inbox for a secure password reset link.",
      });
    } catch {
      setFormState({
        status: "error",
        message: "We couldn’t send a reset email. Please try again.",
      });
    }
  }

  return (
    <form className="sign-in-form" onSubmit={handleSubmit}>
      <label>
        Email address
        <input
          required
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@yourstudio.com"
        />
      </label>
      <label>
        <span className="label-row">
          Password
          <button type="button" onClick={handlePasswordReset}>
            Forgot password?
          </button>
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
          <>Sign in <ArrowRight size={17} /></>
        )}
      </button>
      <p className="sign-up-copy">
        New to StudioHub? <Link href="/auth/login?mode=trial">Start a free trial</Link>
      </p>
    </form>
  );
}
