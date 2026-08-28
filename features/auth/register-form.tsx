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
export function RegisterForm({
  next,
  intent = "studio",
}: {
  next?: string;
  intent?: "client" | "studio";
}) {
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
    /**
     * Creating the account and sending its verification email are two separate
     * failures, and this used to treat them as one.
     *
     * All four steps sat in one `try` with one `catch` that said "We couldn't
     * create that account. The address may already be registered." So when the
     * *third* step failed — a Functions cold start, an App Check hiccup, a mail
     * provider outage — a brand-new customer was told their address was taken,
     * by a product that had just taken it. The account existed, unverified,
     * with no verification email ever sent; the browser was left signed in as
     * that half-made identity because `signOut` never ran; and retrying was
     * impossible, because by then the address really was registered.
     *
     * The first thing anybody does with this product is the thing that broke.
     */
    const { auth } = getFirebaseClient();
    try {
      const credential = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );
      await updateProfile(credential.user, { displayName: name });
    } catch (caught: unknown) {
      // The one failure the old message was right about, said only when true.
      const code =
        typeof caught === "object" && caught !== null && "code" in caught
          ? String((caught as { code: unknown }).code)
          : "";
      setState("error");
      setMessage(
        code === "auth/email-already-in-use"
          ? "That address already has an account. Sign in instead, or reset the password if you have forgotten it."
          : code === "auth/weak-password"
            ? "Pick a longer password — at least 12 characters."
            : code === "auth/invalid-email"
              ? "That email address does not look right. Check it and try again."
              : "We could not create your account just now. Nothing was saved, so please try again in a moment.",
      );
      return;
    }

    // Past this line the account exists. Nothing below may claim otherwise.
    try {
      await requestBrandedAuthEmail({
        type: "emailVerification",
        idempotencyKey: crypto.randomUUID(),
        input: {
          email,
          next: safeNext,
        },
      });
      setState("sent");
      setMessage(
        intent === "client"
          ? "Check your email to verify your account. The secure link will return you to your invitation."
          : "Check your email to verify your account. Then sign in to create your studio.",
      );
    } catch {
      // Recoverable, and only if we say so: the account is real and the person
      // can ask for the email again from the sign-in page.
      setState("sent");
      setMessage(
        "Your account was created, but we could not send the verification email. Use “Forgot password?” on the sign-in page to receive a secure link, or try signing in again shortly.",
      );
    } finally {
      // Always, so a failed send never leaves the browser holding a session for
      // an account that has not verified its address.
      await signOut(auth).catch(() => {});
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
        {intent === "client" ? "Invited email" : "Work email"}
        <input
          name="email"
          required
          type="email"
          autoComplete="email"
          placeholder={
            intent === "client"
              ? "The email that received the invitation"
              : "you@yourstudio.com"
          }
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
            {intent === "client" ? "Create client access" : "Create account"}{" "}
            <ArrowRight size={17} />
          </>
        )}
      </button>
      <p className="sign-up-copy">
        Already registered? <Link href={safeNext ? `/auth/login?next=${encodeURIComponent(safeNext)}` : "/auth/login"}>Sign in</Link>
      </p>
    </form>
  );
}
