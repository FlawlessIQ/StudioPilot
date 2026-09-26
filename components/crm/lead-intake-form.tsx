"use client";

import { useState, useSyncExternalStore } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, CheckCircle2, LoaderCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { publicLeadIntakeSchema, type PublicLeadIntake } from "@/features/leads/schema";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { AddressField } from "@/components/forms/address-field";
import {
  placeCity,
  placeLabel,
  type CapturedPlace,
} from "@/features/places/schema";
import { friendlyError } from "@/lib/ai/friendly-error";

type PublicLeadIntakeInput = z.input<typeof publicLeadIntakeSchema>;

type SubmissionResult = {
  leadId: string;
  duplicate: boolean;
  availabilityStatus: "available" | "conflict" | "unknown";
  missingInformation: string[];
};

const defaultValues: Omit<PublicLeadIntake, "tenantSlug"> = {
  firstName: "",
  lastName: "",
  partnerName: null,
  email: "",
  phone: "",
  eventDate: "",
  eventType: "wedding",
  venue: null,
  city: "",
  estimatedGuestCount: null,
  servicesRequested: ["photography"],
  budgetRange: null,
  referralSource: null,
  message: "",
  // Consent a person actually gave: the box arrived ticked, so the only way to
  // withhold it was to notice it and untick it. Opt-in is the point of asking.
  consent: false,
  source: "public_inquiry",
  honeypot: "",
};

export function LeadIntakeForm({
  tenantSlug,
  brandName,
  preview = false,
}: {
  tenantSlug: string;
  brandName: string;
  /**
   * The studio looking at its own form (`?preview=studio`). A submit shows
   * what a couple sees and saves nothing. It used to create a real lead, and
   * the first lead a studio ever has hides Today's "Get your inquiries in"
   * card for good and ticks setup's "How do inquiries reach you?" — so a
   * studio testing its form was told capture was done.
   */
  preview?: boolean;
}) {
  const hydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<PublicLeadIntakeInput, unknown, PublicLeadIntake>({
    defaultValues: { ...defaultValues, tenantSlug },
    resolver: zodResolver(publicLeadIntakeSchema),
  });

  const [venue, setVenue] = useState<CapturedPlace | null>(null);

  /**
   * The captured venue fills the two fields the inquiry actually submits.
   * City is required, so a chosen venue completing it saves a step; a
   * half-typed one must never wipe a city already entered by hand.
   */
  function applyVenue(place: CapturedPlace | null) {
    setVenue(place);
    setValue("venue", place ? placeLabel(place).slice(0, 160) : null, {
      shouldValidate: true,
    });
    const city = placeCity(place);
    if (city) setValue("city", city.slice(0, 120), { shouldValidate: true });
  }

  /**
   * A refused submit has to say so.
   *
   * `handleSubmit` runs validation first and does nothing at all when it
   * fails — no request, no message, no movement. With the failing field off
   * screen (City sits below the fold on a laptop) pressing "Send inquiry"
   * looked like a dead button. Walked on 2026-09-22: four presses, no
   * feedback, and the studio never heard from that inquiry.
   */
  const onInvalid = (fieldErrors: Record<string, unknown>) => {
    const names = Object.keys(fieldErrors);
    setServerError(
      names.length === 1
        ? "One thing is missing — it is highlighted below."
        : `${names.length} things are missing — they are highlighted below.`,
    );
    const first = names[0];
    if (!first) return;
    const field = document.querySelector<HTMLElement>(`[name="${first}"]`);
    field?.scrollIntoView({ behavior: "smooth", block: "center" });
    field?.focus({ preventScroll: true });
  };

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    const endpoint = process.env.NEXT_PUBLIC_CRM_FUNCTIONS_URL;

    if (!endpoint || preview) {
      setResult({
        leadId: `DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        duplicate: false,
        availabilityStatus: "unknown",
        missingInformation: [
          ...(values.venue ? [] : ["venue"]),
          ...(values.budgetRange ? [] : ["budget range"]),
        ],
      });
      return;
    }

    try {
      const appCheckToken = await getAppCheckToken();
      const response = await fetch(`${endpoint.replace(/\/$/, "")}/publicLeadIntake`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
        },
        body: JSON.stringify(values),
      });
      const payload = (await response.json()) as
        | SubmissionResult
        | { error?: string; message?: string };
      if (!response.ok || !("leadId" in payload)) {
        throw new Error("message" in payload ? payload.message : "Inquiry could not be submitted.");
      }
      setResult(payload);
    } catch (error: unknown) {
      const message = friendlyError(error, "");
      setServerError(
        message === "INVALID_INQUIRY"
          ? "Some details didn't look right. Check the highlighted fields and try again."
          : message === "RATE_LIMITED"
            ? "Too many inquiries from this connection. Please wait a minute and try again."
            : "Your inquiry could not be submitted. Please try again, or email the studio directly.",
      );
    }
  }, onInvalid);

  if (result) {
    return (
      <section className="inquiry-success" aria-live="polite">
        <span><CheckCircle2 size={24} /></span>
        <p className="eyebrow">Inquiry received</p>
        <h2>Thank you. We’ll be in touch shortly.</h2>
        <p>
          {/* Couples don't need a raw UUID; a short suffix is enough to quote
              in a follow-up and looks like a confirmation, not a database id. */}
          Your confirmation code is{" "}
          <strong>{result.leadId.slice(-6).toUpperCase()}</strong>. Our team
          will review the event details and confirm availability before
          discussing packages.
        </p>
        {result.missingInformation.length > 0 ? (
          <small>
            We may follow up about: {result.missingInformation.join(", ")}.
          </small>
        ) : null}
        {preview ? (
          <small className="demo-disclosure">
            Preview: this is what a couple sees. Nothing was saved, and no inquiry
            was created.
          </small>
        ) : !process.env.NEXT_PUBLIC_CRM_FUNCTIONS_URL ? (
          <small className="demo-disclosure">
            Development preview: no record was persisted because the CRM Functions URL
            is not configured.
          </small>
        ) : null}
      </section>
    );
  }

  return (
    <form className="inquiry-form" onSubmit={submit} noValidate>
      {preview ? (
        <p className="demo-disclosure" role="note">
          You&apos;re previewing your form. Try it — submitting won&apos;t create an inquiry.
        </p>
      ) : null}
      <div className="form-section-heading">
        <span>01</span>
        <div><h2>Tell us about you</h2><p>We’ll use these details only to respond to your inquiry.</p></div>
      </div>
      <div className="form-grid">
        <label>First name <span className="required-mark">Required</span><input {...register("firstName")} autoComplete="given-name" /><small>{errors.firstName?.message}</small></label>
        <label>Last name <span className="required-mark">Required</span><input {...register("lastName")} autoComplete="family-name" /><small>{errors.lastName?.message}</small></label>
        <label>Partner or contact name<input {...register("partnerName", { setValueAs: (value) => value || null })} /></label>
        <label>Email <span className="required-mark">Required</span><input {...register("email")} type="email" autoComplete="email" /><small>{errors.email?.message}</small></label>
        <label>Phone <span className="required-mark">Required</span><input {...register("phone")} type="tel" autoComplete="tel" /><small>{errors.phone?.message}</small></label>
      </div>

      <div className="form-section-heading">
        <span>02</span>
        <div><h2>Event details</h2><p>Dates are checked before availability is confirmed.</p></div>
      </div>
      <div className="form-grid">
        <label>Event date <span className="required-mark">Required</span><input {...register("eventDate")} type="date" /><small>{errors.eventDate?.message}</small></label>
        <label>Event type<select {...register("eventType")}><option value="wedding">Wedding</option><option value="corporate">Corporate</option><option value="sports">Sports</option><option value="other">Other</option></select></label>
        {/* The venue a couple types here is the first thing the studio
            ever learns about the job, and it fed straight through to the
            project. Looking it up means the studio gets the real place
            rather than whatever fitted in the box — and it fills the city
            below, which is required. */}
        <div className="form-span">
          <AddressField
            hint="If you have chosen one. Start typing and pick from the list."
            label="Venue"
            onChange={applyVenue}
            placeholder="Venue name or address"
            source={{ kind: "public", tenantSlug }}
            value={venue}
          />
        </div>
        <label>City <span className="required-mark">Required</span><input {...register("city")} /><small>{errors.city?.message}</small></label>
        <label>Estimated guests<input {...register("estimatedGuestCount", { setValueAs: (value) => value ? Number(value) : null })} type="number" min="1" /></label>
        <label>Budget range<select {...register("budgetRange", { setValueAs: (value) => value || null })}><option value="">Prefer not to say</option><option>$3,000–$5,000</option><option>$5,000–$8,000</option><option>$8,000–$12,000</option><option>$12,000+</option></select></label>
        <label className="form-span">How did you hear about us?<input {...register("referralSource", { setValueAs: (value) => value || null })} /></label>
        <label className="form-span">What are you planning? <span className="required-mark">Required</span><textarea {...register("message")} rows={5} placeholder="Tell us what matters most, the atmosphere, and anything we should know." /><small>{errors.message?.message}</small></label>
        <label className="honeypot" aria-hidden="true">Website<input {...register("honeypot")} tabIndex={-1} autoComplete="off" /></label>
      </div>
      <label className="consent-row">
        <input {...register("consent")} type="checkbox" />
        <span>I agree that {brandName} may contact me about this inquiry.</span>
      </label>
      {errors.consent ? <p className="form-error">{errors.consent.message}</p> : null}
      {serverError ? <p className="form-error" role="alert">{serverError}</p> : null}
      <button className="button button-dark inquiry-submit" disabled={!hydrated || isSubmitting} type="submit">
        {isSubmitting ? <LoaderCircle className="spin" size={17} /> : null}
        Send inquiry <ArrowRight size={16} />
      </button>
    </form>
  );
}
