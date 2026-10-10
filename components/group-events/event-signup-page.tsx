"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CalendarDays, CheckCircle2, CreditCard, LoaderCircle, MapPin, UserPlus } from "lucide-react";
import { Actions, AppBar, Button, Card, Field, KitRoot, Main, Note, PoweredBy, Screen, type Studio } from "@/components/kit/kit";
import { getOptionalAppCheckToken } from "@/lib/firebase/app-check";
import type { EventPaymentMethod, SignupState } from "@/features/group-events/signup";

/**
 * A parent's sign-up for a group event: `/e/{token}`
 * (docs/group-event-signup-plan-2026-10-10.md).
 *
 * Reached from a link the studio sent, or a QR code scanned at the field, so
 * it's one short page on a phone, no account: pick a package, say who you
 * are, choose how to pay. Then a confirmation number to show at the field,
 * and the same by email. A parent with two athletes signs up again; their
 * own details stay filled in.
 */

type Option = { id: string; name: string; priceCents: number; description: string | null; price: string };
type Order = {
  confirmationCode: string;
  athleteName: string;
  packageName: string;
  amount: string;
  paid: boolean;
  cancelled: boolean;
  payment: { method: EventPaymentMethod; label: string; howToPay: string; payUrl: string | null } | null;
};
type View = {
  studio: { name: string; logoUrl: string | null };
  event: { name: string; date: string | null; venue: string | null; city: string | null };
  state: SignupState;
  closesAt: string | null;
  options: Option[];
  methods: { method: EventPaymentMethod; label: string }[];
  order: Order | null;
  /** From an order page: where to sign up another athlete, while sign-up is open. */
  signupPath: string | null;
};

const friendly: Record<string, string> = {
  EVENT_LINK_NOT_FOUND: "This link isn’t working. Ask the studio for a new one.",
  EVENT_LINK_RETIRED: "This link has been replaced. Ask the studio for the new one.",
  EVENT_SIGNUP_CLOSED: "Sign-up for this event has closed. Talk to the studio at the event.",
  EVENT_FULL: "This event is full. Talk to the studio at the event.",
  EVENT_OPTION_UNAVAILABLE: "That package isn’t offered any more. Please choose another.",
  EVENT_METHOD_UNAVAILABLE: "That way to pay isn’t offered any more. Please choose another.",
  ORDER_NOT_FOUND: "We couldn’t find that order. Check the link in your email.",
  RATE_LIMITED: "Too many sign-ups from here just now. Please wait a few minutes and try again.",
  APP_CHECK_REQUIRED: "Your browser couldn’t be checked. Reload the page and try again.",
  INVALID_SIGNUP: "A few details are missing. Check the fields marked below.",
};

const stateCopy: Record<Exclude<SignupState, "open">, string> = {
  not_set_up: "Sign-up for this event hasn’t opened yet. Check back soon, or ask the studio.",
  closed: friendly.EVENT_SIGNUP_CLOSED!,
  full: friendly.EVENT_FULL!,
};

const fieldLabels: Record<string, string> = {
  parentName: "Your name",
  email: "Your email",
  athleteName: "Athlete’s name",
  optionId: "A package",
  method: "How you’ll pay",
  consent: "Checking the box above",
};

/** "Saturday, October 18" for a date-only event date. */
function eventDay(date: string | null): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${date.slice(0, 10)}T12:00:00Z`),
  );
}

function OrderCard({ order, onAnother, studioName }: { order: Order; onAnother?: () => void; studioName: string }) {
  return (
    <>
      <Card tone="accent">
        <p className="event-signup-done">
          <CheckCircle2 aria-hidden size={22} />
          {order.cancelled ? "This order was canceled" : order.paid ? "Paid — thank you" : "You’re signed up"}
        </p>
        <p className="event-signup-code-label">Confirmation number</p>
        <p className="event-signup-code">{order.confirmationCode}</p>
        <dl className="event-signup-summary">
          <div>
            <dt>Athlete</dt>
            <dd>{order.athleteName}</dd>
          </div>
          <div>
            <dt>Package</dt>
            <dd>{order.packageName}</dd>
          </div>
          <div>
            <dt>{order.paid ? "Paid" : "To pay"}</dt>
            <dd>{order.amount}</dd>
          </div>
        </dl>
      </Card>
      {order.payment && !order.paid && !order.cancelled ? (
        <Card>
          <h2 className="event-signup-heading">How to pay</h2>
          <p>{order.payment.howToPay}</p>
          {order.payment.payUrl ? (
            <a className="kit-button" href={order.payment.payUrl} rel="noopener" target="_blank">
              <CreditCard aria-hidden size={20} />
              {order.payment.method === "venmo" ? `Pay ${order.amount} on Venmo` : `Pay ${order.amount} online`}
            </a>
          ) : null}
        </Card>
      ) : null}
      {!order.paid && !order.cancelled ? (
        <Note>We’ve emailed this to you. Show the confirmation number to {studioName} at the event.</Note>
      ) : null}
      {onAnother ? (
        <Button icon={UserPlus} onClick={onAnother} variant="secondary">
          Sign up another athlete
        </Button>
      ) : null}
    </>
  );
}

type Loaded = { view: View } | { error: string };

/** The event, or one parent's order, as the public route shows it. */
async function fetchView(token: string | null, orderToken: string | null): Promise<Loaded> {
  const params = new URLSearchParams(orderToken ? { order: orderToken } : { token: token ?? "" });
  try {
    const response = await fetch(`/api/public/event-signup?${params.toString()}`, { cache: "no-store" });
    const body = (await response.json()) as View & { error?: string };
    if (!response.ok) return { error: friendly[body.error ?? ""] ?? friendly.EVENT_LINK_NOT_FOUND! };
    return { view: body };
  } catch {
    return { error: "This page couldn’t load. Check your connection and try again." };
  }
}

/**
 * `token` for the event's sign-up link (/e/{token}); `orderToken` for one
 * parent's order (/e/order/{orderToken}), the link in their emails.
 */
export function EventSignupPage({ token, orderToken }: { token: string | null; orderToken: string | null }) {
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [optionId, setOptionId] = useState<string | null>(null);
  const [method, setMethod] = useState<EventPaymentMethod | null>(null);
  const [parentName, setParentName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [athleteName, setAthleteName] = useState("");
  const [team, setTeam] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [order, setOrder] = useState<Order | null>(null);

  const apply = useCallback((result: Loaded) => {
    if ("error" in result) {
      setLoadError(result.error);
      return;
    }
    setView(result.view);
    if (result.view.order) setOrder(result.view.order);
    // One package or one way to pay: nothing to choose.
    if (result.view.options.length === 1) setOptionId(result.view.options[0]!.id);
    if (result.view.methods.length === 1) setMethod(result.view.methods[0]!.method);
  }, []);
  const load = useCallback(() => fetchView(token, orderToken).then(apply), [apply, orderToken, token]);

  useEffect(() => {
    let live = true;
    void fetchView(token, orderToken).then((result) => {
      if (live) apply(result);
    });
    return () => {
      live = false;
    };
  }, [apply, orderToken, token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const gaps = [
      !optionId && "optionId",
      !parentName.trim() && "parentName",
      !/^\S+@\S+\.\S+$/.test(email.trim()) && "email",
      !athleteName.trim() && "athleteName",
      !method && "method",
      !consent && "consent",
    ].filter((gap): gap is string => Boolean(gap));
    setMissing(gaps);
    if (gaps.length) {
      setError(`Still needed: ${gaps.map((gap) => fieldLabels[gap]).join(", ")}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const appCheck = await getOptionalAppCheckToken();
      const response = await fetch("/api/public/event-signup", {
        method: "POST",
        headers: { "content-type": "application/json", ...(appCheck ? { "x-firebase-appcheck": appCheck } : {}) },
        body: JSON.stringify({
          token,
          parentName,
          email,
          phone: phone.trim() || null,
          athleteName,
          team: team.trim() || null,
          optionId,
          method,
          consent,
          website,
        }),
      });
      const body = (await response.json()) as { order?: Order; orderPath?: string | null; error?: string; fields?: string[] };
      if (!response.ok || !body.order) {
        if (body.fields?.length) setMissing(body.fields);
        setError(friendly[body.error ?? ""] ?? "Your sign-up didn’t go through. Please try again.");
        if (body.error === "EVENT_OPTION_UNAVAILABLE" || body.error === "EVENT_METHOD_UNAVAILABLE") void load();
        return;
      }
      setOrder(body.order);
      // A reload shows the order, not a blank form.
      if (body.orderPath) window.history.replaceState(null, "", body.orderPath);
      window.scrollTo({ top: 0 });
    } catch {
      setError("Your sign-up didn’t go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function another() {
    // From an order page, the sign-up is a page of its own.
    if (!token) {
      if (view?.signupPath) window.location.assign(view.signupPath);
      return;
    }
    setOrder(null);
    setAthleteName("");
    setTeam("");
    setConsent(false);
    setError(null);
    setMissing([]);
    if (view && view.options.length > 1) setOptionId(null);
    window.history.replaceState(null, "", `/e/${token}`);
    window.scrollTo({ top: 0 });
  }

  const studio: Studio | undefined = view ? { name: view.studio.name, logoUrl: view.studio.logoUrl } : undefined;
  const day = eventDay(view?.event.date ?? null);
  const where = [view?.event.venue, view?.event.city].filter(Boolean).join(", ");
  const chosen = view?.options.find((option) => option.id === optionId) ?? null;
  const flagged = (field: string) => (missing.includes(field) ? "Required" : undefined);

  return (
    <KitRoot>
      <Screen>
        <AppBar studio={studio} />
        <Main label="Event sign-up">
          {loadError ? (
            <Card>
              <Note tone="danger">{loadError}</Note>
            </Card>
          ) : !view ? (
            <p className="event-signup-loading" role="status">
              <LoaderCircle aria-hidden className="spin" size={18} /> Loading…
            </p>
          ) : (
            <>
              <header className="event-signup-intro">
                <h1>{view.event.name}</h1>
                {day ? (
                  <p>
                    <CalendarDays aria-hidden size={16} /> {day}
                  </p>
                ) : null}
                {where ? (
                  <p>
                    <MapPin aria-hidden size={16} /> {where}
                  </p>
                ) : null}
              </header>

              {order ? (
                <OrderCard
                  onAnother={(token && view.state === "open") || view.signupPath ? another : undefined}
                  order={order}
                  studioName={view.studio.name}
                />
              ) : view.state !== "open" ? (
                <Card>
                  <Note>{stateCopy[view.state]}</Note>
                </Card>
              ) : (
                <form className="event-signup-form" id="event-signup" noValidate onSubmit={(event) => void submit(event)}>
                  <fieldset className="event-signup-group">
                    <legend>Pick a package</legend>
                    {flagged("optionId") ? <span className="kit-error">Choose a package.</span> : null}
                    {view.options.map((option) => (
                      <label className="event-signup-option" data-selected={option.id === optionId} key={option.id}>
                        <input
                          checked={option.id === optionId}
                          name="option"
                          onChange={() => setOptionId(option.id)}
                          type="radio"
                          value={option.id}
                        />
                        <span className="event-signup-option-text">
                          <span className="event-signup-option-name">{option.name}</span>
                          {option.description ? <span className="event-signup-option-detail">{option.description}</span> : null}
                        </span>
                        <span className="event-signup-option-price">{option.price}</span>
                      </label>
                    ))}
                  </fieldset>

                  <fieldset className="event-signup-group">
                    <legend>The athlete</legend>
                    <Field
                      autoComplete="off"
                      error={flagged("athleteName")}
                      label="Athlete’s name"
                      maxLength={120}
                      onChange={(event) => setAthleteName(event.target.value)}
                      value={athleteName}
                    />
                    <Field
                      autoComplete="off"
                      hint="Optional"
                      label="Team or group"
                      maxLength={80}
                      onChange={(event) => setTeam(event.target.value)}
                      value={team}
                    />
                  </fieldset>

                  <fieldset className="event-signup-group">
                    <legend>You</legend>
                    <Field
                      autoComplete="name"
                      error={flagged("parentName")}
                      label="Your name"
                      maxLength={120}
                      onChange={(event) => setParentName(event.target.value)}
                      value={parentName}
                    />
                    <Field
                      autoComplete="email"
                      error={flagged("email") ? "Add an email so we can send your confirmation." : undefined}
                      inputMode="email"
                      label="Your email"
                      maxLength={254}
                      onChange={(event) => setEmail(event.target.value)}
                      type="email"
                      value={email}
                    />
                    <Field
                      autoComplete="tel"
                      hint="Optional"
                      inputMode="tel"
                      label="Mobile"
                      maxLength={40}
                      onChange={(event) => setPhone(event.target.value)}
                      type="tel"
                      value={phone}
                    />
                  </fieldset>

                  <fieldset className="event-signup-group">
                    <legend>How you’ll pay</legend>
                    {flagged("method") ? <span className="kit-error">Choose how you’ll pay.</span> : null}
                    {view.methods.map((choice) => (
                      <label className="event-signup-option" data-selected={choice.method === method} key={choice.method}>
                        <input
                          checked={choice.method === method}
                          name="method"
                          onChange={() => setMethod(choice.method)}
                          type="radio"
                          value={choice.method}
                        />
                        <span className="event-signup-option-text">
                          <span className="event-signup-option-name">{choice.label}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>

                  <label className="event-signup-consent" data-missing={flagged("consent") ? "" : undefined}>
                    <input checked={consent} onChange={(event) => setConsent(event.target.checked)} type="checkbox" />
                    <span>
                      {`I’m the athlete’s parent or guardian, and ${view.studio.name} may use these details for this order. See how StudioCue handles them in its`}{" "}
                      <a href="/privacy" rel="noopener" target="_blank">
                        privacy policy
                      </a>
                      .
                    </span>
                  </label>

                  {/* Hidden from people; a bot fills every field. */}
                  <label aria-hidden="true" className="honeypot">
                    Website
                    <input autoComplete="off" onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} value={website} />
                  </label>
                </form>
              )}
              <PoweredBy />
            </>
          )}
        </Main>
        {view && !order && view.state === "open" ? (
          <Actions note={error ? <span className="kit-error" role="alert">{error}</span> : undefined}>
            <Button disabled={busy} form="event-signup" type="submit">
              {busy ? <LoaderCircle aria-hidden className="spin" size={18} /> : null}
              {chosen ? `Sign up — ${chosen.price}` : "Sign up"}
            </Button>
          </Actions>
        ) : null}
      </Screen>
    </KitRoot>
  );
}
