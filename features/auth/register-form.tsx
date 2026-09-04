"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import { ArrowRight, CheckCircle2, LoaderCircle, ShieldAlert } from "lucide-react";
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
  /** The address the verification went to, so the confirmation can name it. */
  const [sentTo, setSentTo] = useState("");
  const [state, setState] = useState<
    "idle" | "submitting" | "sent" | "created_unverified" | "error"
  >("idle");
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
      setSentTo(email);
      setState("sent");
      setMessage(
        intent === "client"
          ? "The secure link will return you to your invitation."
          : "Open it, then sign in and we\u2019ll set your studio up.",
      );
    } catch {
      // P2: the account is real but the verification email did not go out. This
      // must NOT reuse the "sent" screen — that screen says "We sent a link",
      // which would contradict "we could not send" on the same page. Its own
      // honest state, and it points at signing in (where the verify wall now
      // offers a resend — P4), never at "Forgot password?" (a reset link does
      // not verify an email, and the same throttled browser cannot send it).
      setSentTo(email);
      setState("created_unverified");
      setMessage("");
    } finally {
      // Always, so a failed send never leaves the browser holding a session for
      // an account that has not verified its address.
      await signOut(auth).catch(() => {});
    }
  }
  /**
   * Success replaces the form, rather than adding a line under it.
   *
   * Submitting left the heading reading "Create your account", the fields
   * still filled, the button still saying "Create account" (disabled, but a
   * disabled button is not an answer), and one grey line added below. The
   * account had been created and the page looked like it had not moved.
   * `/studio/projects/new` already resolves its own success this way.
   */
  if (state === "sent") {
    return (
      <div className="command-success">
        <CheckCircle2 size={23} />
        <h2>Check your email</h2>
        <p>
          We sent a verification link to <strong>{sentTo}</strong>. {message}
        </p>
        <Link
          className="button button-dark"
          href={
            safeNext
              ? `/auth/login?next=${encodeURIComponent(safeNext)}`
              : "/auth/login"
          }
        >
          Go to sign in <ArrowRight size={15} />
        </Link>
      </div>
    );
  }
  if (state === "created_unverified") {
    return (
      <div className="command-success">
        <ShieldAlert size={23} />
        <h2>Account created — one step left</h2>
        <p>
          Your account for <strong>{sentTo}</strong> is ready, but we couldn’t
          send the verification link just now. Sign in with the password you
          just chose and we’ll offer to send it again.
        </p>
        <Link
          className="button button-dark"
          href={
            safeNext
              ? `/auth/login?next=${encodeURIComponent(safeNext)}`
              : "/auth/login"
          }
        >
          Go to sign in <ArrowRight size={15} />
        </Link>
      </div>
    );
  }
  return (
    <form className="sign-in-form" onSubmit={submit}>
      <label>
        Your name <span className="required-mark">Required</span>
        <input
          name="name"
          required
          minLength={2}
          autoComplete="name"
          placeholder="Alex Morgan"
        />
      </label>
      <label>
        {intent === "client" ? "Invited email" : "Work email"} <span className="required-mark">Required</span>
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
        Password <span className="required-mark">Required</span>
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
        // "sent" no longer reaches here — the confirmation above replaces the
        // whole form — so submitting is the only state that disables it.
        disabled={state === "submitting"}
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
