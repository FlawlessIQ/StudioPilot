"use client";

import { useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowLeft, CheckCircle2, LoaderCircle, Mail, Phone, Send, Users } from "lucide-react";
import { useForm, useWatch, type UseFormRegisterReturn } from "react-hook-form";
import type { PublicLeadIntake, PublicLeadIntakeInput } from "@/features/leads/schema";
// The browser check without Zod (H5): features/leads/public-intake-validate.ts.
import { publicLeadIntakeResolver } from "@/features/leads/public-intake-validate";
import {
  dayFieldsFor,
  defaultInquiryFormConfig,
  inquirySkipsDetails,
  questionsForType,
  type InquiryEventType,
  type InquiryFormConfig,
  type InquiryQuestion,
} from "@/features/leads/inquiry-form-config";
import { inquiryFormThemeStyle } from "@/features/leads/inquiry-form-theme";
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
import { placeCity, placeLabel } from "@/features/places/place-text";
import type { CapturedPlace } from "@/features/places/schema";
import { friendlyError } from "@/lib/ai/friendly-error";
import { useEmbedFrame } from "@/components/crm/use-embed-frame";


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
 * Short steps, one field per row, the next step in the thumb zone (M2 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md). It was one long
 * fourteen-field page that ran off an iPhone. Each step is checked before the
 * next opens, so a refusal is always on the screen being looked at.
 *
 * The steps follow the studio's own form (features/leads/inquiry-form-
 * config.ts, GR Productions 2026-10-01): what the inquiry is about is chosen
 * at the end of the first step, so "your day" asks only what that type asks —
 * a date and a city for a cheer shoot, not a venue and a guest count — and a
 * general question skips it and goes straight to the message.
 */
type StepKey = "you" | "day" | "more";

const STEP_FIELDS: Record<StepKey, ReadonlyArray<keyof PublicLeadIntakeInput>> = {
  you: ["firstName", "lastName", "email", "phone", "eventTypeKey", "eventType", "partnerName"],
  day: ["eventDate", "venue", "city", "estimatedGuestCount", "coiRequired", "venueContactName", "venueContactEmail"],
  more: ["message", "customAnswers", "budgetRange", "referralSource", "consent", "honeypot"],
};

function stepCopy(key: StepKey, type: InquiryEventType | null, dated: boolean): { title: string; lede: string } {
  const wedding = !type || type.kind === "wedding";
  if (key === "you") return { title: "Let’s start with you", lede: "A few details so we can reply to you personally." };
  if (key === "day")
    return {
      title: wedding ? "Tell us about your day" : "When and where?",
      lede: dated ? "Dates are checked before availability is confirmed." : "A few details help us plan.",
    };
  if (type?.kind === "general")
    return { title: "How can we help?", lede: "Ask us anything. A few lines is plenty." };
  return { title: "What matters most?", lede: "Anything you’d like us to know. A few lines is plenty." };
}

const COI_ANSWERS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "not_sure", label: "Not sure" },
] as const;

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;

const BUDGETS = [
  { value: "$3,000–$5,000", label: "$3–5k" },
  { value: "$5,000–$8,000", label: "$5–8k" },
  { value: "$8,000–$12,000", label: "$8–12k" },
  { value: "$12,000+", label: "$12k+" },
  { value: "none", label: "Rather not say" },
] as const;

const REFERRALS = ["Instagram", "Google", "A friend", "Our planner", "Other"] as const;

const DEFAULT_FORM = defaultInquiryFormConfig();

/** "Label Required", or the label alone with "Optional" as its hint. */
function marked(label: string, required: boolean): ReactNode {
  return required ? (
    <>
      {label} <span className="required-mark">Required</span>
    </>
  ) : (
    label
  );
}

/**
 * Bring a field into view and focus it: by name, or by a chip group's
 * wrapper (`data-field`), since a hidden input can't be scrolled to.
 */
function reveal(name: string) {
  // A timer, not requestAnimationFrame: rAF does not run in a hidden tab,
  // and the step may need to render before the field exists.
  window.setTimeout(() => {
    const field =
      document.querySelector<HTMLElement>(`[data-field="${name}"]`) ??
      document.querySelector<HTMLElement>(`[name="${name}"]`);
    field?.scrollIntoView({ behavior: "smooth", block: "center" });
    (field?.querySelector<HTMLElement>("button, input, textarea") ?? field)?.focus({ preventScroll: true });
  }, 60);
}

/**
 * One of the studio's own questions. Typed answers are the input's own
 * (registered, so typing never re-renders the form); a choice is a chip group
 * over a hidden input, like the other chip questions here.
 */
function CustomQuestion({
  question,
  registration,
  error,
  value,
  onChoose,
}: {
  question: InquiryQuestion;
  registration: UseFormRegisterReturn;
  error?: string;
  value: string | null;
  onChoose: (next: string) => void;
}) {
  const label = marked(question.label, question.required);
  const hint = question.required ? undefined : "Optional";
  if (question.type === "short_text")
    return <Field error={error} hint={hint} label={label} maxLength={200} {...registration} />;
  if (question.type === "long_text") return <TextArea error={error} hint={hint} label={label} rows={3} {...registration} />;
  const options =
    question.type === "yes_no" ? YES_NO : question.options.map((option) => ({ value: option, label: option }));
  return (
    <div data-field={registration.name}>
      <input type="hidden" {...registration} />
      <Choices legend={label} onChange={(next) => onChoose(next as string)} options={options} value={value} />
      {error ? (
        <p className="kit-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function LeadIntakeForm({
  tenantSlug,
  brandName,
  studio,
  config = DEFAULT_FORM,
  preview = false,
  embedded = false,
}: {
  tenantSlug: string;
  brandName: string;
  /** The studio's brand: couples are writing to the studio, not StudioCue. */
  studio?: Studio;
  /** The studio's own form, read server-side from its inquiry settings. */
  config?: InquiryFormConfig;
  /**
   * The studio looking at its own form (`?preview=studio`). A submit shows
   * what a couple sees and saves nothing. It used to create a real lead, and
   * the first lead a studio ever has hides Today's "Get your inquiries in"
   * card for good and ticks setup's "How do inquiries reach you?" — so a
   * studio testing its form was told capture was done.
   */
  preview?: boolean;
  /**
   * Framed in the studio's own website (`?embed=1`, H10). No studio bar — the
   * studio's page is the brand around it — no full-screen height, and the
   * frame is told its height (use-embed-frame.ts).
   */
  embedded?: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const hydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<(SubmissionResult & { dated: boolean }) | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  /**
   * Whether a refused send is being explained. The count is read live from
   * `errors`, not stored with the message: a stored "2 things are missing"
   * stayed on screen after the couple had fixed both (production, 2026-09-29).
   */
  const [missingShown, setMissingShown] = useState(false);
  /**
   * When the current step appeared. "Continue" on step 2 and "Send inquiry" on
   * step 3 sit in the same place, so a double tap on Continue sent step 3
   * before anyone saw it, and it opened with every field already in red.
   */
  const stepShownAt = useRef(0);
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
    resolver: publicLeadIntakeResolver<PublicLeadIntakeInput>(config),
  });
  const brand: Studio = studio ?? { name: brandName };
  // The studio's button colour and background, readable whatever was picked.
  const theme = useMemo(() => inquiryFormThemeStyle(studio?.color, config), [studio?.color, config]);
  useEmbedFrame(embedded, frameRef, result ? "done" : String(step));
  const kitClass = embedded ? "is-embedded" : undefined;

  // A studio with one kind of inquiry asks nothing: it is that one.
  const types = config.eventTypes;
  const onlyType = types.length === 1 ? types[0]! : null;
  // Only the chip groups follow these; the rest of the form stays put.
  const typeKey = useWatch({ control, name: "eventTypeKey" }) ?? onlyType?.id ?? null;
  const budget = useWatch({ control, name: "budgetRange" });
  const coiRequired = useWatch({ control, name: "coiRequired" });
  const answers = (useWatch({ control, name: "customAnswers" }) ?? {}) as Record<string, string | undefined>;
  const chosenType = types.find((type) => type.id === typeKey) ?? null;
  const day = dayFieldsFor(chosenType);
  const steps: StepKey[] = inquirySkipsDetails(chosenType) ? ["you", "more"] : ["you", "day", "more"];
  const stepIndex = Math.min(step, steps.length - 1);
  const stepKey = steps[stepIndex]!;
  const questions = questionsForType(config, chosenType);

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
    // The found place itself, so the venue's certificate starts from a real
    // postal address rather than a label (H3).
    setValue("venuePlace", place?.verified ? place : null);
    if (!place?.verified || (getValues("city") ?? "").trim()) return;
    const city = placeCity(place);
    if (city && day.city !== "hidden") setValue("city", city.slice(0, 120), { shouldValidate: true });
  }

  function chooseType(type: InquiryEventType) {
    setValue("eventTypeKey", type.id, { shouldDirty: true, shouldValidate: true });
    // The studio's label is what the inquiry is stored as (eventTypeLabel).
    setValue("eventType", type.label, { shouldDirty: true, shouldValidate: Boolean(errors.eventType) });
    // Asked only for a wedding; not sent for anything else.
    if (type.kind !== "wedding") setValue("partnerName", null);
  }

  function goTo(next: number) {
    setServerError(null);
    setMissingShown(false);
    stepShownAt.current = Date.now();
    setStep(next);
    // The window, not the heading: scrolling the heading to the top put it
    // under the sticky studio bar.
    window.scrollTo({ top: 0 });
  }

  async function continueFrom(current: number) {
    const fields = STEP_FIELDS[steps[current]!];
    if (await trigger([...fields])) return goTo(current + 1);
    // Read the result now: `errors` here is from the render before trigger.
    const first = fields.find((name) => getFieldState(name).invalid) ?? fields[0]!;
    if (first === "eventTypeKey" || first === "eventType") return reveal("eventType");
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
    setServerError(null);
    setMissingShown(true);
    const first = names[0];
    if (!first) return;
    const ownerKey = (Object.keys(STEP_FIELDS) as StepKey[]).find((key) =>
      (STEP_FIELDS[key] as readonly string[]).includes(first),
    );
    const owner = ownerKey ? steps.indexOf(ownerKey) : -1;
    if (owner >= 0 && owner !== stepIndex) setStep(owner);
    // One of the studio's own questions: its error sits under its id.
    const nested = fieldErrors[first] as Record<string, unknown> | undefined;
    const target =
      first === "customAnswers" && nested && !("message" in nested)
        ? `customAnswers.${Object.keys(nested)[0] ?? ""}`
        : first === "eventTypeKey"
          ? "eventType"
          : first;
    reveal(target);
  };

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    setMissingShown(false);
    const endpoint = process.env.NEXT_PUBLIC_CRM_FUNCTIONS_URL;
    const dated = Boolean(values.eventDate);

    if (!endpoint || preview) {
      setResult({
        leadId: `DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        duplicate: false,
        availabilityStatus: "unknown",
        // Only what this form asked: no "budget" for a studio that doesn't ask it.
        missingInformation: [
          ...(day.venue && !values.venue ? ["venue"] : []),
          ...(config.askBudget && !values.budgetRange ? ["budget range"] : []),
        ],
        dated,
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
      setResult({ ...payload, dated });
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
      <div ref={frameRef}>
      <KitRoot className={kitClass} studio={brand} theme={theme}>
        <Screen>
          {embedded ? null : <AppBar studio={brand} />}
          <Main label="Inquiry sent">
            <section className="kit-stack" aria-live="polite">
              <Note icon={CheckCircle2} tone="accent">
                Inquiry received · confirmation{" "}
                <strong>{result.leadId.slice(-6).toUpperCase()}</strong>
              </Note>
              <h1 className="kit-title">Thank you. We’ll be in touch shortly.</h1>
              <p className="kit-body">
                {result.dated
                  ? `${brand.name} will look at your date and details and reply personally, before any talk of packages.`
                  : `${brand.name} will read your message and reply personally.`}
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
      </div>
    );
  }

  const copy = stepCopy(stepKey, chosenType, day.eventDate !== "hidden");
  const missingCount = Object.keys(errors).length;
  const answerError = (id: string) => (errors.customAnswers as Record<string, { message?: string } | undefined> | undefined)?.[id]?.message;

  return (
    <div ref={frameRef}>
    <KitRoot className={kitClass} studio={brand} theme={theme}>
      <Screen>
        {embedded ? null : (
          <AppBar
            back={
              preview ? { href: "/studio/setup", label: "Back to Studio setup" } : undefined
            }
            studio={brand}
          />
        )}
        <form
          noValidate
          onFocusCapture={prewarmAppCheck}
          onSubmit={(event) => {
            // The second tap of a double tap on Continue, not a send.
            if (Date.now() - stepShownAt.current < 600) return event.preventDefault();
            void submit(event);
          }}
          style={{ display: "contents" }}
        >
          <Main label="Inquiry">
            <div className="kit-stack">
              {preview ? (
                <Note>You’re previewing your form. Try it — submitting won’t create an inquiry.</Note>
              ) : null}
              <Steps step={stepIndex + 1} total={steps.length} />
              <div className="kit-stack-tight">
                <p className="kit-eyebrow">{`Step ${stepIndex + 1} of ${steps.length}`}</p>
                <h1 className="kit-title">{copy.title}</h1>
                <p className="kit-body">{copy.lede}</p>
              </div>
            </div>

            {stepKey === "you" ? (
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
                {/* The chips and the value are one thing: nothing is lit
                    until a type is chosen, and Continue says so rather than
                    silently refusing (the local UAT run, 2026-09-29, found a
                    lit chip over an empty value). A studio with one type
                    starts with it chosen and shows no chips. */}
                <input defaultValue={onlyType?.id ?? ""} type="hidden" {...register("eventTypeKey")} />
                <input defaultValue={onlyType?.label ?? ""} type="hidden" {...register("eventType")} />
                {onlyType ? null : (
                  <div data-field="eventType">
                    <Choices
                      legend={<>What are you getting in touch about? <span className="required-mark">Required</span></>}
                      onChange={(next) => {
                        const type = types.find((candidate) => candidate.id === next);
                        if (type) chooseType(type);
                      }}
                      options={types.map((type) => ({ value: type.id, label: type.label }))}
                      value={chosenType?.id ?? null}
                    />
                    {errors.eventType || errors.eventTypeKey ? (
                      <p className="kit-error" role="alert">
                        Choose what you&rsquo;re getting in touch about.
                      </p>
                    ) : null}
                  </div>
                )}
                {chosenType?.kind === "wedding" ? (
                  <Field
                    hint="Optional"
                    label="Partner’s name"
                    {...register("partnerName", { setValueAs: (value) => value || null })}
                  />
                ) : null}
              </div>
            ) : null}

            {stepKey === "day" ? (
              <div className="kit-stack">
                {day.eventDate !== "hidden" ? (
                  <Field
                    error={errors.eventDate?.message}
                    hint={day.eventDate === "required" ? "Tap to pick the date." : "Optional — leave it empty if you’re not sure yet."}
                    label={
                      day.eventDate === "required" ? (
                        chosenType?.kind === "portraits" ? (
                          <>Session date <span className="required-mark">Required</span></>
                        ) : (
                          <>Event date <span className="required-mark">Required</span></>
                        )
                      ) : chosenType?.kind === "portraits" ? (
                        "Session date"
                      ) : (
                        "Event date"
                      )
                    }
                    type="date"
                    {...register("eventDate")}
                  />
                ) : null}
                {day.venue ? (
                  <AddressField
                    hint="If you have chosen one. Start typing and pick from the list."
                    label="Venue"
                    onChange={applyVenue}
                    placeholder="Venue name or address"
                    source={{ kind: "public", tenantSlug }}
                    value={venue}
                  />
                ) : null}
                {day.city !== "hidden" ? (
                  <Field
                    autoComplete="address-level2"
                    error={errors.city?.message}
                    hint={day.city === "required" ? undefined : "Optional"}
                    label={
                      day.city === "required" ? (
                        <>City <span className="required-mark">Required</span></>
                      ) : (
                        "City"
                      )
                    }
                    {...register("city")}
                  />
                ) : null}
                {day.coi && venue ? (
                  <>
                    <input type="hidden" {...register("coiRequired", { setValueAs: (value) => value || null })} />
                    <Choices
                      legend="Does your venue ask vendors for a certificate of insurance?"
                      onChange={(next) => {
                        setValue("coiRequired", next as "yes" | "no" | "not_sure", { shouldDirty: true });
                        if (next !== "yes") {
                          setValue("venueContactName", null);
                          setValue("venueContactEmail", null, { shouldValidate: true });
                        }
                      }}
                      options={COI_ANSWERS}
                      value={(coiRequired ?? null) as (typeof COI_ANSWERS)[number]["value"] | null}
                    />
                    {coiRequired === "yes" ? (
                      <>
                        <Field
                          autoComplete="off"
                          hint="Optional."
                          label="Venue coordinator’s name"
                          {...register("venueContactName", { setValueAs: (value) => value || null })}
                        />
                        <Field
                          autoComplete="off"
                          error={errors.venueContactEmail?.message}
                          hint="Optional — we send the certificate to them, so you don’t have to."
                          icon={Mail}
                          inputMode="email"
                          label="Venue coordinator’s email"
                          type="email"
                          {...register("venueContactEmail", { setValueAs: (value) => value || null })}
                        />
                      </>
                    ) : null}
                  </>
                ) : null}
                {day.guests ? (
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
                ) : null}
              </div>
            ) : null}

            {stepKey === "more" ? (
              <div className="kit-stack">
                <TextArea
                  error={errors.message?.message}
                  label={
                    chosenType?.kind === "general" ? (
                      <>Your message <span className="required-mark">Required</span></>
                    ) : (
                      <>What are you planning? <span className="required-mark">Required</span></>
                    )
                  }
                  placeholder={
                    chosenType?.kind === "general"
                      ? "Tell us what you’d like to know."
                      : "Tell us what matters most, the atmosphere, and anything we should know."
                  }
                  rows={5}
                  {...register("message")}
                />
                {/* The studio's own questions (Settings → Inquiry capture). */}
                {questions.map((question) => (
                  <CustomQuestion
                    error={answerError(question.id)}
                    key={question.id}
                    onChoose={(next) =>
                      setValue(`customAnswers.${question.id}`, next, { shouldDirty: true, shouldValidate: missingShown })
                    }
                    question={question}
                    registration={register(`customAnswers.${question.id}`)}
                    value={answers[question.id] || null}
                  />
                ))}
                {config.askBudget ? (
                  <>
                    <input type="hidden" {...register("budgetRange", { setValueAs: (value) => value || null })} />
                    <Choices
                      legend="Photography budget"
                      onChange={(next) =>
                        setValue("budgetRange", next === "none" ? null : (next as string), { shouldDirty: true })
                      }
                      options={BUDGETS}
                      value={(budget ?? "none") as (typeof BUDGETS)[number]["value"]}
                    />
                  </>
                ) : null}
                {config.askReferral ? (
                  <>
                    <input type="hidden" {...register("referralSource", { setValueAs: (value) => value || null })} />
                    <Choices
                      legend="How did you hear about us?"
                      onChange={(next) => {
                        setReferral(next as string);
                        setValue("referralSource", next === "Other" ? null : (next as string), {
                          shouldDirty: true,
                        });
                      }}
                      // "Our planner" means something at a wedding or an event;
                      // not for a family session or a sports day.
                      options={REFERRALS.filter(
                        (label) => label !== "Our planner" || !["portraits", "sports"].includes(String(chosenType?.kind)),
                      ).map((label) => ({ value: label, label }))}
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
                  </>
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
            ) : missingShown && missingCount ? (
              <p className="kit-note" data-tone="danger" role="alert">
                {missingCount === 1
                  ? "One thing is missing — it is highlighted below."
                  : `${missingCount} things are missing — they are highlighted below.`}
              </p>
            ) : null}
            <PoweredBy />
          </Main>

          <Actions note={stepIndex === 0 ? `Your details stay with ${brand.name}.` : undefined}>
            {stepIndex === steps.length - 1 ? (
              <ButtonRow>
                <Button icon={ArrowLeft} onClick={() => goTo(stepIndex - 1)} size="compact" variant="secondary">
                  Back
                </Button>
                <Button disabled={!hydrated || isSubmitting} type="submit">
                  {isSubmitting ? <LoaderCircle aria-hidden="true" className="spin" size={18} /> : <Send aria-hidden="true" size={18} />}
                  Send inquiry
                </Button>
              </ButtonRow>
            ) : stepIndex > 0 ? (
              <ButtonRow>
                <Button icon={ArrowLeft} onClick={() => goTo(stepIndex - 1)} size="compact" variant="secondary">
                  Back
                </Button>
                <Button onClick={() => void continueFrom(stepIndex)}>Continue</Button>
              </ButtonRow>
            ) : (
              <Button onClick={() => void continueFrom(stepIndex)}>Continue</Button>
            )}
          </Actions>
        </form>
      </Screen>
    </KitRoot>
    </div>
  );
}
