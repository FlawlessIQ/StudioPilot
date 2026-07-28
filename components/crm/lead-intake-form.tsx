"use client";

import { useState, useSyncExternalStore } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, CheckCircle2, LoaderCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { publicLeadIntakeSchema, type PublicLeadIntake } from "@/features/leads/schema";
import { getAppCheckToken } from "@/lib/firebase/app-check";

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
  consent: true,
  source: "public_inquiry",
  honeypot: "",
};

export function LeadIntakeForm({
  tenantSlug,
  brandName,
}: {
  tenantSlug: string;
  brandName: string;
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
    formState: { errors, isSubmitting },
  } = useForm<PublicLeadIntakeInput, unknown, PublicLeadIntake>({
    defaultValues: { ...defaultValues, tenantSlug },
    resolver: zodResolver(publicLeadIntakeSchema),
  });

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    const endpoint = process.env.NEXT_PUBLIC_CRM_FUNCTIONS_URL;

    if (!endpoint) {
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
      setServerError(error instanceof Error ? error.message : "Inquiry could not be submitted.");
    }
  });

  if (result) {
    return (
      <section className="inquiry-success" aria-live="polite">
        <span><CheckCircle2 size={24} /></span>
        <p className="eyebrow">Inquiry received</p>
        <h2>Thank you. We’ll be in touch shortly.</h2>
        <p>
          Your reference is <strong>{result.leadId}</strong>. Our team will review the
          event details and confirm availability before discussing packages.
        </p>
        {result.missingInformation.length > 0 ? (
          <small>
            We may follow up about: {result.missingInformation.join(", ")}.
          </small>
        ) : null}
        {!process.env.NEXT_PUBLIC_CRM_FUNCTIONS_URL ? (
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
      <div className="form-section-heading">
        <span>01</span>
        <div><h2>Tell us about you</h2><p>We’ll use these details only to respond to your inquiry.</p></div>
      </div>
      <div className="form-grid">
        <label>First name<input {...register("firstName")} autoComplete="given-name" /><small>{errors.firstName?.message}</small></label>
        <label>Last name<input {...register("lastName")} autoComplete="family-name" /><small>{errors.lastName?.message}</small></label>
        <label>Partner or contact name<input {...register("partnerName", { setValueAs: (value) => value || null })} /></label>
        <label>Email<input {...register("email")} type="email" autoComplete="email" /><small>{errors.email?.message}</small></label>
        <label>Phone<input {...register("phone")} type="tel" autoComplete="tel" /><small>{errors.phone?.message}</small></label>
      </div>

      <div className="form-section-heading">
        <span>02</span>
        <div><h2>Event details</h2><p>Dates are checked before availability is confirmed.</p></div>
      </div>
      <div className="form-grid">
        <label>Event date<input {...register("eventDate")} type="date" /><small>{errors.eventDate?.message}</small></label>
        <label>Event type<select {...register("eventType")}><option value="wedding">Wedding</option><option value="corporate">Corporate</option><option value="sports">Sports</option><option value="other">Other</option></select></label>
        <label>Venue<input {...register("venue", { setValueAs: (value) => value || null })} placeholder="If selected" /></label>
        <label>City<input {...register("city")} /><small>{errors.city?.message}</small></label>
        <label>Estimated guests<input {...register("estimatedGuestCount", { setValueAs: (value) => value ? Number(value) : null })} type="number" min="1" /></label>
        <label>Budget range<select {...register("budgetRange", { setValueAs: (value) => value || null })}><option value="">Prefer not to say</option><option>$3,000–$5,000</option><option>$5,000–$8,000</option><option>$8,000–$12,000</option><option>$12,000+</option></select></label>
        <label className="form-span">How did you hear about us?<input {...register("referralSource", { setValueAs: (value) => value || null })} /></label>
        <label className="form-span">What are you planning?<textarea {...register("message")} rows={5} placeholder="Tell us what matters most, the atmosphere, and anything we should know." /><small>{errors.message?.message}</small></label>
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
