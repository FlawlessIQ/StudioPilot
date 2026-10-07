"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, CheckCircle2 } from "lucide-react";
import { HEARD_OPTIONS, rememberedAttribution } from "@/features/growth/attribution";
import { getOptionalAppCheckToken } from "@/lib/firebase/app-check";

/**
 * "Book a demo" (app/api/public/demo). Files the photographer on the
 * Console's pipeline and tells the team; nothing is emailed to the address
 * typed here. When the team has set a calendar link, the thank-you offers it.
 */
export function DemoForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [bookingUrl, setBookingUrl] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setMessage("");
    const data = new FormData(event.currentTarget);
    const value = (key: string) => String(data.get(key) ?? "").trim();
    try {
      const token = await getOptionalAppCheckToken();
      const response = await fetch("/api/public/demo", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { "x-firebase-appcheck": token } : {}) },
        body: JSON.stringify({
          name: value("name"),
          studioName: value("studioName"),
          email: value("email"),
          phone: value("phone"),
          website: value("website"),
          message: value("message"),
          preferredTimes: value("preferredTimes"),
          heard: value("heard") || null,
          attribution: rememberedAttribution(),
          companyUrl: value("companyUrl"),
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; bookingUrl?: string | null; error?: string };
      if (!response.ok || !result.ok) {
        setState("error");
        setMessage(
          result.error === "RATE_LIMITED"
            ? "That's a few requests in a row. Try again in an hour, or email support@studio-cue.com."
            : result.error === "INVALID_REQUEST"
              ? "Check your name and email, then try again."
              : "That didn't go through. Try again, or email support@studio-cue.com.",
        );
        return;
      }
      setBookingUrl(result.bookingUrl ?? null);
      setState("sent");
    } catch {
      setState("error");
      setMessage("That didn't go through. Try again, or email support@studio-cue.com.");
    }
  }

  if (state === "sent")
    return (
      <div className="marketing-demo-done" role="status">
        <CheckCircle2 aria-hidden />
        <h2>Thanks. We&apos;ll be in touch within a business day.</h2>
        {bookingUrl ? (
          <>
            <p>Or pick a time that suits you now.</p>
            <a className="button button-dark" href={bookingUrl} rel="noreferrer" target="_blank">
              <CalendarDays /> Pick a time
            </a>
          </>
        ) : (
          <p>We&apos;ll reply by email to set up a time.</p>
        )}
        <p>
          <Link href="/auth/register">Or start your 14-day trial now <ArrowRight /></Link>
        </p>
      </div>
    );

  return (
    <form className="sign-in-form marketing-demo-form" onSubmit={submit}>
      <div className="marketing-demo-row">
        <label>
          Your name <span className="required-mark">Required</span>
          <input autoComplete="name" maxLength={120} minLength={2} name="name" required />
        </label>
        <label>
          Studio name
          <input autoComplete="organization" maxLength={160} name="studioName" />
        </label>
      </div>
      <div className="marketing-demo-row">
        <label>
          Email <span className="required-mark">Required</span>
          <input autoComplete="email" maxLength={200} name="email" required type="email" />
        </label>
        <label>
          Phone
          <input autoComplete="tel" maxLength={40} name="phone" type="tel" />
        </label>
      </div>
      <label>
        Website or Instagram
        <input maxLength={200} name="website" placeholder="yourstudio.com or @yourstudio" />
      </label>
      <label>
        What would you like to see?
        <textarea maxLength={4000} name="message" placeholder="How you run things today, how many weddings and events a year, what takes the most time" rows={4} />
      </label>
      <label>
        Good days and times for a call
        <input maxLength={300} name="preferredTimes" placeholder="Weekday mornings, Eastern" />
      </label>
      <label>
        How did you hear about StudioCue?
        <select defaultValue="" name="heard">
          <option value="">Choose one</option>
          {HEARD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label aria-hidden className="marketing-demo-trap">
        Leave this empty
        <input autoComplete="off" name="companyUrl" tabIndex={-1} />
      </label>
      {message ? (
        <p className="form-error" role="alert">
          {message}
        </p>
      ) : null}
      <button className="button button-dark sign-in-submit" disabled={state === "sending"} type="submit">
        {state === "sending" ? "Sending…" : "Book a demo"}
      </button>
      <p className="marketing-demo-note">
        {"We use these details only to arrange your demo. See our "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </form>
  );
}
