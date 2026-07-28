"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { getFirebaseClient } from "@/lib/firebase/client";
import { requestBrandedAuthEmail } from "@/lib/auth/email-client";
import { authIsLive } from "@/lib/runtime-mode";
export function RegisterForm({ next }: { next?: string }) {
  const [state, setState] = useState<"idle" | "submitting" | "sent" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    setMessage("");
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name"));
    const email = String(data.get("email"));
    const password = String(data.get("password"));
    if (!authIsLive) {
      setState("sent");
      setMessage(
        "Development preview: registration is ready, but no Firebase account was created.",
      );
      return;
    }
    try {
      const { auth } = getFirebaseClient();
      const credential = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );
      await updateProfile(credential.user, { displayName: name });
      await requestBrandedAuthEmail({
        type: "emailVerification",
        idempotencyKey: crypto.randomUUID(),
        input: {
          email,
          next: safeNext,
        },
      });
      await signOut(auth);
      setState("sent");
      setMessage(
        "Check your email to verify your account. Then sign in to create your studio.",
      );
    } catch {
      setState("error");
      setMessage(
        "We couldn’t create that account. The address may already be registered.",
      );
    }
  }
  return (
    <form className="sign-in-form" onSubmit={submit}>
      <label>
        Your name
        <input
          name="name"
          required
          minLength={2}
          autoComplete="name"
          placeholder="Alex Morgan"
        />
      </label>
      <label>
        Work email
        <input
          name="email"
          required
          type="email"
          autoComplete="email"
          placeholder="you@yourstudio.com"
        />
      </label>
      <label>
        Password
        <input
          name="password"
          required
          type="password"
          minLength={12}
          autoComplete="new-password"
          placeholder="At least 12 characters"
        />
      </label>
      {message ? (
        <p
          className={state === "error" ? "form-error" : "form-success"}
          role="status"
        >
          {message}
        </p>
      ) : null}
      <button
        className="button button-dark sign-in-submit"
        type="submit"
        disabled={state === "submitting" || state === "sent"}
      >
        {state === "submitting" ? (
          <LoaderCircle className="spin" size={17} />
        ) : (
          <>
            Create account <ArrowRight size={17} />
          </>
        )}
      </button>
      <p className="sign-up-copy">
        Already registered? <Link href={safeNext ? `/auth/login?next=${encodeURIComponent(safeNext)}` : "/auth/login"}>Sign in</Link>
      </p>
    </form>
  );
}
