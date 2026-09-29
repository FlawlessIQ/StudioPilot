"use client";

import { useState, useSyncExternalStore } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, CheckCircle2, LoaderCircle, Mail, Phone, Send, Users } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { publicLeadIntakeSchema, type PublicLeadIntake } from "@/features/leads/schema";
import { AddressField } from "@/components/forms/address-field";
import {
  Actions,
  AppBar,
  Button,
  ButtonRow,
  Card,
  Choices,
  Field,
  KitRoot,
  Main,
  Note,
  PoweredBy,
  Screen,
  Steps,
  TextArea,
  type Studio,
} from "@/components/kit/kit";
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

/**
 * Only the values no input holds.
 *
 * The page arrives as HTML and looks ready long before its JavaScript is. A
 * couple who started typing in that gap lost it: on hydration react-hook-form
 * writes each registered field's default into the input, and every default
 * here was "". A field with no default is read from the input instead, so
 * what was typed is kept (walked 2026-09-28; the form is 1.5 MB of script on
 * a phone). The empty values still come from the inputs themselves. Consent
 * stays opt-in because the box renders unticked.
 */
export const inquiryFormDefaults: Partial<PublicLeadIntakeInput> = {
  venue: null,
  servicesRequested: ["photography"],
  source: "public_inquiry",
};

/**
 * Start the browser check while they type, not when they press Send.
 *
 * App Check (reCAPTCHA) used to load on submit, so Send waited for it, up to
 * ten seconds, before the inquiry even left. Firebase is also kept out of the
 * page until then. A failure here is ignored: submit asks again and reports it.
 */
let appCheckWarmed = false;
function prewarmAppCheck() {
  if (appCheckWarmed || !process.env.NEXT_PUBLIC_CRM_FUNCTIONS_URL) return;
  appCheckWarmed = true;
  void import("@/lib/firebase/app-check")
    .then(({ getOptionalAppCheckToken }) => getOptionalAppCheckToken())
    .catch(() => undefined);
}

/**
 * Three short steps, one field per row, the next step in the thumb zone
 * (M2 of docs/mobile-first-client-crew-plan-2026-09-28.md). It was one long
 * fourteen-field page that ran off an iPhone. Each step is checked before the
 * next opens, so a refusal is always on the screen being looked at.
 */
const STEPS = [
  {
    eyebrow: "Step 1 of 3",
    title: "Let’s start with you",
    lede: "A few details so we can reply to you personally.",
    fields: ["firstName", "lastName", "partnerName", "email", "phone"],
  },
  {
    eyebrow: "Step 2 of 3",
    title: "Tell us about your day",
    lede: "Dates are checked before availability is confirmed.",
    fields: ["eventDate", "eventType", "venue", "city", "estimatedGuestCount"],
  },
  {
    eyebrow: "Step 3 of 3",
    title: "What matters most?",
    lede: "Anything you’d like us to know. A few lines is plenty.",
    fields: ["message", "budgetRange", "referralSource", "consent", "honeypot"],
  },
] as const satisfies ReadonlyArray<{
  eyebrow: string;
  title: string;
  lede: string;
  fields: ReadonlyArray<keyof PublicLeadIntakeInput>;
}>;

const EVENT_TYPES = [
  { value: "wedding", label: "Wedding" },
  { value: "corporate", label: "Corporate" },
  { value: "sports", label: "Sports" },
  { value: "other", label: "Other" },
] as const;

const BUDGETS = [
  { value: "$3,000–$5,000", label: "$3–5k" },
  { value: "$5,000–$8,000", label: "$5–8k" },
  { value: "$8,000–$12,000", label: "$8–12k" },
  { value: "$12,000+", label: "$12k+" },
  { value: "none", label: "Rather not say" },
] as const;

const REFERRALS = ["Instagram", "Google", "A friend", "Our planner", "Other"] as const;

export function LeadIntakeForm({
  tenantSlug,
  brandName,
  studio,
  preview = false,
}: {
  tenantSlug: string;
  brandName: string;
  /** The studio's brand: couples are writing to the studio, not StudioCue. */
  studio?: Studio;
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
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    trigger,
    control,
    getFieldState,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<PublicLeadIntakeInput, unknown, PublicLeadIntake>({
    defaultValues: { ...inquiryFormDefaults, tenantSlug },
    resolver: zodResolver(publicLeadIntakeSchema),
  });
  const brand: Studio = studio ?? { name: brandName };
  // Only the two chip groups follow these; the rest of the form stays put.
  const eventType = useWatch({ control, name: "eventType" }) ?? "wedding";
  const budget = useWatch({ control, name: "budgetRange" });

  const [venue, setVenue] = useState<CapturedPlace | null>(null);
  const [referral, setReferral] = useState<string | null>(null);

  /**
   * The captured venue fills the two fields the inquiry actually submits.
   * City is required, so a chosen venue completing it saves a step; a
   * half-typed one must never wipe a city already entered by hand.
   *
   * Only a place picked from the list fills City, and only an empty City.
   * Typed text used to be split on commas on every keystroke, so writing
   * "The Barn, 12 Main St, Hope, NJ" rewrote City at each comma, over
   * whatever the couple had already entered. Typing also no longer
   * validates the whole form on every letter.
   */
  function applyVenue(place: CapturedPlace | null) {
    // The box keeps its own typing. Holding each keystroke here as well
    // re-rendered the whole form per letter; only a chosen place (or a
    // cleared box) is something the field needs handed back.
    if (!place || place.verified) setVenue(place);
    setValue("venue", place ? placeLabel(place).slice(0, 160) : null, {
      shouldValidate: Boolean(place?.verified),
    });
    if (!place?.verified || (getValues("city") ?? "").trim()) return;
    const city = placeCity(place);
    if (city) setValue("city", city.slice(0, 120), { shouldValidate: true });
  }

  function goTo(next: number) {
    setServerError(null);
    setStep(next);
    // The window, not the heading: scrolling the heading to the top put it
    // under the sticky studio bar.
    window.scrollTo({ top: 0 });
  }

  async function continueFrom(current: number) {
    const fields = STEPS[current]!.fields;
    if (await trigger([...fields])) return goTo(current + 1);
    // Read the result now: `errors` here is from the render before trigger.
    const first = fields.find((name) => getFieldState(name).invalid) ?? fields[0];
    setFocus(first);
  }

  /**
   * A refused submit has to say so.
   *
   * `handleSubmit` runs validation first and does nothing at all when it
   * fails — no request, no message, no movement. With the failing field off
   * screen pressing "Send inquiry" looked like a dead button. Walked on
   * 2026-09-22: four presses, no feedback, and the studio never heard from
   * that inquiry. With steps, the refusal also has to reopen the step that
   * holds the field.
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
    const owner = STEPS.findIndex((candidate) =>
      (candidate.fields as readonly string[]).includes(first),
    );
    if (owner >= 0 && owner !== step) setStep(owner);
    // A timer, not requestAnimationFrame: rAF does not run in a hidden tab,
    // and the step may need to render before the field exists.
    window.setTimeout(() => {
      const field = document.querySelector<HTMLElement>(`[name="${first}"]`);
      field?.scrollIntoView({ behavior: "smooth", block: "center" });
      field?.focus({ preventScroll: true });
    }, 60);
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
      const { getAppCheckToken } = await import("@/lib/firebase/app-check");
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
      <KitRoot studio={brand}>
        <Screen>
          <AppBar studio={brand} />
          <Main label="Inquiry sent">
            <section className="kit-stack" aria-live="polite">
              <Note icon={CheckCircle2} tone="accent">
                Inquiry received · confirmation{" "}
                <strong>{result.leadId.slice(-6).toUpperCase()}</strong>
              </Note>
              <h1 className="kit-title">Thank you. We’ll be in touch shortly.</h1>
              <p className="kit-body">
                {`${brand.name} will look at your date and details and reply personally, before any talk of packages.`}
              </p>
              {result.missingInformation.length > 0 ? (
                <p className="kit-caption">
                  We may follow up about: {result.missingInformation.join(", ")}.
                </p>
              ) : null}
              {preview ? (
                <Note>
                  Preview: this is what a couple sees. Nothing was saved, and no inquiry
                  was created.
                </Note>
              ) : !process.env.NEXT_PUBLIC_CRM_FUNCTIONS_URL ? (
                <Note>
                  Development preview: no record was persisted because the CRM Functions
                  URL is not configured.
                </Note>
              ) : null}
            </section>
            <PoweredBy />
          </Main>
        </Screen>
      </KitRoot>
    );
  }

  const current = STEPS[step]!;

  return (
    <KitRoot studio={brand}>
      <Screen>
        <AppBar
          back={
            preview ? { href: "/studio/setup", label: "Back to Studio setup" } : undefined
          }
          studio={brand}
        />
        <form noValidate onFocusCapture={prewarmAppCheck} onSubmit={submit} style={{ display: "contents" }}>
          <Main label="Inquiry">
            <div className="kit-stack">
              {preview ? (
                <Note>You’re previewing your form. Try it — submitting won’t create an inquiry.</Note>
              ) : null}
              <Steps step={step + 1} total={STEPS.length} />
              <div className="kit-stack-tight">
                <p className="kit-eyebrow">{current.eyebrow}</p>
                <h1 className="kit-title">{current.title}</h1>
                <p className="kit-body">{current.lede}</p>
              </div>
            </div>

            {step === 0 ? (
              <div className="kit-stack">
                <Field
                  autoComplete="given-name"
                  error={errors.firstName?.message}
                  label={<>First name <span className="required-mark">Required</span></>}
                  {...register("firstName")}
                />
                <Field
                  autoComplete="family-name"
                  error={errors.lastName?.message}
                  label={<>Last name <span className="required-mark">Required</span></>}
                  {...register("lastName")}
                />
                <Field
                  hint="Optional"
                  label="Partner’s name"
                  {...register("partnerName", { setValueAs: (value) => value || null })}
                />
                <Field
                  autoComplete="email"
                  error={errors.email?.message}
                  icon={Mail}
                  inputMode="email"
                  label={<>Email <span className="required-mark">Required</span></>}
                  type="email"
                  {...register("email")}
                />
                <Field
                  autoComplete="tel"
                  error={errors.phone?.message}
                  icon={Phone}
                  inputMode="tel"
                  label={<>Phone <span className="required-mark">Required</span></>}
                  type="tel"
                  {...register("phone")}
                />
              </div>
            ) : null}

            {step === 1 ? (
              <div className="kit-stack">
                <Field
                  error={errors.eventDate?.message}
                  hint="Tap to pick the date."
                  label={<>Event date <span className="required-mark">Required</span></>}
                  type="date"
                  {...register("eventDate")}
                />
                {/* The chips show Wedding chosen, so the value has to be
                    Wedding too. With no form default (see
                    inquiryFormDefaults) the value is read from this input, and
                    an empty one left the chip lit and Continue silently
                    refused: a couple who kept Wedding could not get past
                    step 2 (found by the local UAT run, 2026-09-29). */}
                <input defaultValue="wedding" type="hidden" {...register("eventType")} />
                <Choices
                  legend="Type of event"
                  onChange={(next) => setValue("eventType", next as string, { shouldDirty: true, shouldValidate: true })}
                  options={EVENT_TYPES}
                  value={eventType as (typeof EVENT_TYPES)[number]["value"]}
                />
                {errors.eventType ? (
                  <p className="kit-error" role="alert">
                    Choose what you&rsquo;re planning.
                  </p>
                ) : null}
                <AddressField
                  hint="If you have chosen one. Start typing and pick from the list."
                  label="Venue"
                  onChange={applyVenue}
                  placeholder="Venue name or address"
                  source={{ kind: "public", tenantSlug }}
                  value={venue}
                />
                <Field
                  autoComplete="address-level2"
                  error={errors.city?.message}
                  label={<>City <span className="required-mark">Required</span></>}
                  {...register("city")}
                />
                <Field
                  hint="Optional — a rough number is fine."
                  icon={Users}
                  inputMode="numeric"
                  label="Estimated guests"
                  min="1"
                  type="number"
                  {...register("estimatedGuestCount", {
                    setValueAs: (value) => (value ? Number(value) : null),
                  })}
                />
              </div>
            ) : null}

            {step === 2 ? (
              <div className="kit-stack">
                <TextArea
                  error={errors.message?.message}
                  label={<>What are you planning? <span className="required-mark">Required</span></>}
                  placeholder="Tell us what matters most, the atmosphere, and anything we should know."
                  rows={5}
                  {...register("message")}
                />
                <input type="hidden" {...register("budgetRange", { setValueAs: (value) => value || null })} />
                <Choices
                  legend="Photography budget"
                  onChange={(next) =>
                    setValue("budgetRange", next === "none" ? null : (next as string), { shouldDirty: true })
                  }
                  options={BUDGETS}
                  value={(budget ?? "none") as (typeof BUDGETS)[number]["value"]}
                />
                <input type="hidden" {...register("referralSource", { setValueAs: (value) => value || null })} />
                <Choices
                  legend="How did you hear about us?"
                  onChange={(next) => {
                    setReferral(next as string);
                    setValue("referralSource", next === "Other" ? null : (next as string), {
                      shouldDirty: true,
                    });
                  }}
                  options={REFERRALS.map((label) => ({ value: label, label }))}
                  value={referral}
                />
                {referral === "Other" ? (
                  <Field
                    label="Where did you find us?"
                    onChange={(event) =>
                      setValue("referralSource", event.target.value.trim() || null, { shouldDirty: true })
                    }
                  />
                ) : null}
                <label className="honeypot" aria-hidden="true">
                  Website
                  <input {...register("honeypot")} tabIndex={-1} autoComplete="off" />
                </label>
                <Card>
                  <label className="kit-check">
                    <input {...register("consent")} type="checkbox" />
                    <span>I agree that {brand.name} may contact me about this inquiry.</span>
                  </label>
                  {errors.consent ? (
                    <p className="kit-error" role="alert">
                      {errors.consent.message}
                    </p>
                  ) : null}
                </Card>
              </div>
            ) : null}

            {serverError ? (
              <p className="kit-note" data-tone="danger" role="alert">
                {serverError}
              </p>
            ) : null}
            <PoweredBy />
          </Main>

          <Actions note={step === 0 ? `Your details stay with ${brand.name}.` : undefined}>
            {step === STEPS.length - 1 ? (
              <ButtonRow>
                <Button icon={ArrowLeft} onClick={() => goTo(step - 1)} size="compact" variant="secondary">
                  Back
                </Button>
                <Button disabled={!hydrated || isSubmitting} type="submit">
                  {isSubmitting ? <LoaderCircle aria-hidden="true" className="spin" size={18} /> : <Send aria-hidden="true" size={18} />}
                  Send inquiry
                </Button>
              </ButtonRow>
            ) : step > 0 ? (
              <ButtonRow>
                <Button icon={ArrowLeft} onClick={() => goTo(step - 1)} size="compact" variant="secondary">
                  Back
                </Button>
                <Button onClick={() => void continueFrom(step)}>Continue</Button>
              </ButtonRow>
            ) : (
              <Button onClick={() => void continueFrom(step)}>Continue</Button>
            )}
          </Actions>
        </form>
      </Screen>
    </KitRoot>
  );
}
