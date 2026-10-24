"use client";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { currencyForTimezone, detectedTimezone } from "@/features/auth/locale-defaults";
import { SignupSteps } from "@/features/auth/signup-steps";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { invalidateMembershipCache, loadMembershipDocuments } from "@/lib/firebase/membership-cache";
import { requestBrandedAuthEmail } from "@/lib/auth/email-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { pendingInvitations, type PendingInvitation } from "@/lib/auth/pending-invitations";
import { HEARD_ASKS_WHO, HEARD_OPTIONS, rememberedAttribution, type HeardValue } from "@/features/growth/attribution";
import { rememberedPromotionCode } from "@/features/subscriptions/promotion-code";
import { chosenTrade } from "@/features/trades/chosen-trade";
import { LIVE_TRADES, TRADE_OPTIONS, type Trade } from "@/features/trades/trades";
import { AddressField } from "@/components/forms/address-field";
import type { CapturedPlace } from "@/features/places/schema";
import { rememberTenantId } from "@/lib/firebase/tab-tenant";

/** What each kind of invitation lets the person do, in a sentence. */
const INVITED_TO: Record<PendingInvitation["kind"], string> = {
  client: "to their client portal",
  crew: "to join their crew",
  team: "to join their team",
};

// P-note (timezone parity): the same list the Studio-settings identity form
// offers, so an owner picks the same zone at signup as they'd see in settings.
const TIMEZONES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "America/New_York", label: "America/New York" },
  { value: "America/Chicago", label: "America/Chicago" },
  { value: "America/Denver", label: "America/Denver" },
  { value: "America/Los_Angeles", label: "America/Los Angeles" },
  { value: "America/Phoenix", label: "America/Phoenix" },
  { value: "America/Anchorage", label: "America/Anchorage" },
  { value: "Pacific/Honolulu", label: "Pacific/Honolulu" },
  { value: "America/Toronto", label: "America/Toronto" },
  { value: "America/Vancouver", label: "America/Vancouver" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "Europe/Dublin", label: "Europe/Dublin" },
  { value: "Europe/Paris", label: "Europe/Paris" },
  { value: "Australia/Sydney", label: "Australia/Sydney" },
];

const noSubscribe = () => () => undefined;

/**
 * The page's heading, set by the form so it can change with what the form
 * is doing: an invited client is not told "You'll be the owner of this
 * studio" above a note saying they were invited somewhere else.
 */
function SetupHeading({ invited, existing = false }: { invited: boolean; existing?: boolean }) {
  if (existing)
    return (
      <>
        <span className="eyebrow">Studio setup</span>
        <h1>Welcome back</h1>
      </>
    );
  return invited ? (
    <>
      <span className="eyebrow">You&rsquo;ve been invited</span>
      <h1>Looking for your studio?</h1>
    </>
  ) : (
    <>
      <SignupSteps current={2} />
      <span className="eyebrow">Studio setup</span>
      <h1>Set up your studio</h1>
      <p>A name is all it needs. You&rsquo;ll be its owner, and everything here can be changed later.</p>
    </>
  );
}

export function OnboardingForm() {
  return <OnboardingFlow />;
}

/**
 * Whether this account already owns a studio. Onboarding makes one studio per
 * account and returns it to a second submit, so the form would only discard
 * what was typed. Any failure is "no": this saves a wasted form, never blocks.
 */
async function ownsAStudio(userId: string): Promise<boolean> {
  try {
    const { firestore } = getFirebaseClient();
    const documents = await loadMembershipDocuments(firestore, userId, { force: true });
    return documents.some((document) => document.data().role === "studio_owner");
  } catch {
    return false;
  }
}

function OnboardingFlow() {
  // The browser's own timezone, once hydrated; the server renders the old
  // default, so the two never disagree mid-hydration. The selects are keyed on
  // it, so they re-mount with the detected defaults rather than keeping the
  // server's.
  const zone = useSyncExternalStore(
    noSubscribe,
    () => detectedTimezone() ?? "America/New_York",
    () => "America/New_York",
  );
  const zones = TIMEZONES.some((option) => option.value === zone)
    ? TIMEZONES
    : [{ value: zone, label: zone.replaceAll("_", " ") }, ...TIMEZONES];
  // Both are detected, so they're said in one line and changed only on
  // request: two required drop-downs a studio almost never needs to touch
  // were half the form (onboarding audit, 2026-10-24).
  const [chosenZone, setChosenZone] = useState<string | null>(null);
  const [chosenCurrency, setChosenCurrency] = useState<string | null>(null);
  const timezone = chosenZone ?? zone;
  const currency = chosenCurrency ?? currencyForTimezone(zone);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // P4/P7: distinct states so the wall can offer a resend, and success stops
  // the form from staying interactive (double-submit) while the redirect lands.
  // `has_studio`: this account already made its studio (onboarding is one
  // studio per account), so the form would only have thrown its answers away.
  const [phase, setPhase] = useState<"form" | "needs_verification" | "invited" | "has_studio" | "done">(
    "form",
  );
  // Studios that have invited this email. Someone a studio invited, signing in
  // without the invitation link, used to land here and create a studio of
  // their own; they are asked first now.
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [invitedEmail, setInvitedEmail] = useState("");
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">(
    "idle",
  );
  const [checkoutNext, setCheckoutNext] = useState(true);
  const [heard, setHeard] = useState<HeardValue | "">("");
  // On contracts and at the bottom of the studio's emails (Email branding).
  const [address, setAddress] = useState<CapturedPlace | null>(null);
  // "What do you do?" (features/trades/trades.ts). Live trades are offered —
  // since 2026-10-12 DJ, makeup and hair, and since its Phase 5 the planner,
  // so the question always shows, starting on the trade the visitor arrived
  // with (`?trade=` from /dj, /makeup, /hair, /planner or a vendor invite). A trade not yet live shows only for that visitor.
  const arrivedWith = useSyncExternalStore(noSubscribe, chosenTrade, () => null);
  const [trade, setTrade] = useState<Trade | "">("");
  const pickedTrade: Trade = trade || arrivedWith || "photographer";
  const tradeChoices = TRADE_OPTIONS.filter(
    (option) => LIVE_TRADES.includes(option.value) || option.value === arrivedWith,
  );

  /**
   * Who is here, before they type anything.
   *
   * A signed-out visitor used to fill in the form and then be told "Your
   * session ended", with no link; an unverified owner filled it in and then hit
   * the verification wall, losing what they'd typed. Both are answered on
   * arrival now (docs/onboarding-assessment-2026-09-26.md).
   */
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_ONBOARDING_FUNCTIONS_URL) return;
    const { auth } = getFirebaseClient();
    let active = true;
    void auth.authStateReady().then(async () => {
      const user = auth.currentUser;
      if (!active) return;
      if (!user) {
        window.location.replace(`/auth/login?next=${encodeURIComponent("/auth/onboarding")}`);
        return;
      }
      await user.reload().catch(() => undefined);
      if (active && !user.emailVerified) {
        setPhase("needs_verification");
        return;
      }
      // Already the owner of a studio: the verification link opened on a
      // phone after the studio was made on a laptop lands here too.
      if (await ownsAStudio(user.uid)) {
        if (active) setPhase("has_studio");
        return;
      }
      const waiting = await pendingInvitations(auth);
      if (active && waiting.length) {
        setInvitations(waiting);
        setInvitedEmail(user.email ?? "");
        setPhase("invited");
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // While on the wall, look every few seconds: verifying on a phone carries
  // this page on by itself.
  useEffect(() => {
    if (phase !== "needs_verification") return;
    const { auth } = getFirebaseClient();
    const timer = window.setInterval(() => {
      const user = auth.currentUser;
      if (!user) return;
      void user.reload().then(async () => {
        if (!user.emailVerified) return;
        await user.getIdToken(true).catch(() => undefined);
        const waiting = await pendingInvitations(auth);
        if (waiting.length) {
          setInvitations(waiting);
          setInvitedEmail(user.email ?? "");
          setPhase("invited");
        } else setPhase("form");
      });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [phase]);

  async function resendVerification() {
    setResendState("sending");
    try {
      const { auth } = getFirebaseClient();
      const email = auth.currentUser?.email;
      if (!email) throw new Error("no session");
      await requestBrandedAuthEmail({
        type: "emailVerification",
        idempotencyKey: crypto.randomUUID(),
        input: { email, next: "/auth/onboarding" },
      });
      setResendState("sent");
      // One link a minute: the server quietly skips a second request inside
      // that window, so the button waits it out rather than claiming a send.
      window.setTimeout(() => setResendState("idle"), 60_000);
    } catch {
      setResendState("idle");
      setNotice(
        "We couldn't send the verification email just now. Try again in a moment, or from a different browser or network.",
      );
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const data = new FormData(event.currentTarget);
    const endpoint = process.env.NEXT_PUBLIC_ONBOARDING_FUNCTIONS_URL;
    if (!endpoint) {
      setNotice(
        "Development preview: studio setup was validated, but no tenant was created.",
      );
      setBusy(false);
      return;
    }
    try {
      const { auth } = getFirebaseClient();
      // P6: wait for Firebase to restore the session before reading it. Reading
      // auth.currentUser synchronously on a fresh page load returns null while
      // the session is still restoring, which told a signed-in owner to "sign
      // in first".
      await auth.authStateReady();
      const user = auth.currentUser;
      if (!user) {
        setNotice("Your session ended — sign in again to finish setup.");
        setBusy(false);
        return;
      }
      await user.reload();
      if (!user.emailVerified) {
        // P4: don't dead-end. Offer to resend from here, where the session is
        // live, instead of throwing a message with no way forward.
        setPhase("needs_verification");
        setBusy(false);
        return;
      }
      const appCheckToken = await getAppCheckToken();
      const response = await fetch(
        `${endpoint.replace(/\/$/, "")}/tenantOnboardingCommand`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${await user.getIdToken(true)}`,
            ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
          },
          body: JSON.stringify({
            businessName: String(data.get("businessName")),
            // Not asked here: it was the studio name again for almost every
            // studio. Agreements use it; it's editable in Studio details.
            legalName: String(data.get("businessName")),
            timezone,
            currency,
            trade: pickedTrade,
            businessAddress: address?.formatted?.trim().slice(0, 240) || null,
            // Where the studio came from, for the Console's Sources page
            // (features/growth/attribution.ts). Never required.
            attribution: {
              heard: heard || null,
              heardDetail: String(data.get("heardDetail") ?? "").trim().slice(0, 120) || null,
              ...rememberedAttribution(),
              promotionCode: rememberedPromotionCode(),
            },
          }),
        },
      );
      const result = (await response.json()) as {
        error?: string;
        tenantId?: string;
        // False for a comped studio — access is already granted, so skip the
        // plan picker and open the workspace directly.
        checkoutRequired?: boolean;
      };
      if (!response.ok) throw new Error(result.error ?? "INTERNAL");
      if (result.tenantId)
        rememberTenantId(result.tenantId);
      // P7: terminal success, form stays disabled so a bounce can't invite a
      // second submit.
      setCheckoutNext(result.checkoutRequired !== false);
      setPhase("done");
      // Card-required trial: onboarding created the studio with an `incomplete`
      // subscription and no access. Rather than assuming Studio-monthly and
      // jumping straight to Stripe, land on the subscription page — the app
      // gate's destination for an ungated studio — where the owner picks a plan
      // and cadence and sees what it includes before checkout. Choosing there
      // opens Stripe; the webhook flips the subscription to `trialing` and the
      // gate opens the workspace. (Dev preview with no billing backend lands in
      // the same place; the page discloses that checkout is disabled.)
      //
      // Two things matter about HOW we get there. First, AuthBoundary caches
      // "no memberships" for 60s, and the register→/studio bounce populates
      // that empty entry seconds before this membership is created — so drop it
      // or the just-created owner is bounced straight back here. Second, use a
      // full-page navigation, not router.replace: it re-bootstraps the whole
      // client (workspace context + a fresh, strongly-consistent membership
      // read) so AuthBoundary sees the new active membership instead of a stale
      // in-memory miss. A soft client nav reuses that stale state and loops.
      invalidateMembershipCache(user.uid);
      // A comped studio is already granted access, so send it straight into the
      // workspace rather than the plan picker; everyone else picks a plan.
      window.location.assign(
        result.checkoutRequired === false ? "/studio/setup" : "/studio/subscription",
      );
    } catch (caught: unknown) {
      // The server's code (or a Zod field list, or an APP_CHECK_ refusal) in
      // words a new studio can act on; never the raw string.
      setNotice(
        friendlyError(caught, "We couldn't create your studio. Try again in a minute."),
      );
      setBusy(false);
    }
  }

  if (phase === "done") {
    return (
      <>
      <SetupHeading invited={false} />
      <div className="command-success">
        {/* It opened a plan picker, not a workspace: say what's next. */}
        <h2>{checkoutNext ? "One last step: start your trial" : "Your studio is ready"}</h2>
        <p>{checkoutNext ? "Opening the plan picker…" : "Opening your workspace…"}</p>
      </div>
      </>
    );
  }

  if (phase === "has_studio") {
    return (
      <>
        <SetupHeading existing invited={false} />
        <div className="command-success">
          <h2>Your studio is ready</h2>
          <p>This account already has a studio. Open it to carry on where you left off.</p>
          <a className="button button-dark" href="/studio">
            Open your studio <ArrowRight size={15} />
          </a>
        </div>
      </>
    );
  }

  if (phase === "invited") {
    const [first, ...others] = invitations;
    return (
      <>
      <SetupHeading invited />
      <div className="command-success">
        <h2>
          {first.studioName} invited you {INVITED_TO[first.kind]}
        </h2>
        <p>
          To join them, open the invitation link in the email sent to{" "}
          <strong>{invitedEmail || "your inbox"}</strong>. It connects this
          account to {first.studioName}, and you won&rsquo;t need to set
          anything up.
        </p>
        {others.length ? (
          <p>
            Also waiting:{" "}
            {others.map((item) => `${item.studioName} (${INVITED_TO[item.kind].replace(/^to /, "")})`).join(", ")}.
          </p>
        ) : null}
        <p>Can&rsquo;t find the email? Ask {first.studioName} to send the invitation again.</p>
        <button className="button button-light" style={{ marginTop: 12 }} type="button" onClick={() => setPhase("form")}>
          I run my own business — set up my own studio
        </button>
      </div>
      </>
    );
  }

  if (phase === "needs_verification") {
    return (
      <>
      <SetupHeading invited={false} />
      <div className="command-success">
        <h2>Verify your email first</h2>
        <p>
          Your studio is one step away. Open the link we emailed you — this page
          carries on by itself once you have.
        </p>
        <button
          className="button button-dark"
          type="button"
          disabled={resendState !== "idle"}
          onClick={() => void resendVerification()}
        >
          {resendState === "sent"
            ? "Link on its way"
            : resendState === "sending"
              ? "Sending…"
              : "Resend verification email"}
        </button>
        {resendState === "sent" ? (
          <p role="status">
            A verification link is on its way. Nothing after a minute? Check
            spam, then you can ask for another.
          </p>
        ) : null}
        {notice ? (
          <p className="form-error" role="status">
            {notice}
          </p>
        ) : null}
      </div>
      </>
    );
  }

  return (
    <>
    <SetupHeading invited={false} />
    <form className="sign-in-form" onSubmit={submit}>
      {/* Five answers, all in view and one tap each: a drop-down hid them
          and cut "Photography or video" off at its own width. */}
      {tradeChoices.length > 1 ? (
        <fieldset className="onboarding-trades">
          <legend>What do you do?</legend>
          <div className="onboarding-trade-options">
            {tradeChoices.map((option) => (
              <label className="onboarding-trade" key={option.value}>
                <input
                  checked={pickedTrade === option.value}
                  name="trade"
                  onChange={() => setTrade(option.value)}
                  type="radio"
                  value={option.value}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <small>{tradeChoices.find((option) => option.value === pickedTrade)?.hint}</small>
        </fieldset>
      ) : null}
      <label>
        {pickedTrade === "photographer" ? "Studio name" : "Business name"}{" "}
        <span className="required-mark">Required</span>
        <input
          name="businessName"
          required
          minLength={2}
          maxLength={120}
          placeholder={pickedTrade === "dj" ? "Spin Theory DJs" : pickedTrade === "makeup" ? "Glow by Ana" : pickedTrade === "hair" ? "Jess Styles Bridal" : pickedTrade === "planner" ? "Willow & Lane Events" : "Alder & Muse Photography"}
        />
        <small>Your legal business name for agreements can be changed any time in Studio details.</small>
      </label>
      {/* Conor, 2026-10-13: the address on contracts and at the bottom of
          the studio's emails, asked once here (Email branding after). */}
      <AddressField
        hint="Goes on your contracts and at the bottom of your emails. Leave it blank if you'd rather not, and add it later in Settings."
        label="Business address"
        onChange={setAddress}
        placeholder="Start typing your address"
        value={address}
      />
      <details className="onboarding-locale">
        <summary>
          <span>
            Times in <strong>{zones.find((option) => option.value === timezone)?.label ?? timezone}</strong>
            {" · "}prices in <strong>{currency}</strong>
          </span>
          <em>Change</em>
        </summary>
        <label>
          Timezone
          <select name="timezone" onChange={(event) => setChosenZone(event.target.value)} value={timezone}>
            {zones.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Currency
          <select name="currency" onChange={(event) => setChosenCurrency(event.target.value)} value={currency}>
            <option value="USD">USD</option>
            <option value="CAD">CAD</option>
            <option value="GBP">GBP</option>
            <option value="EUR">EUR</option>
            <option value="AUD">AUD</option>
          </select>
        </label>
      </details>
      <label>
        How did you hear about StudioCue?
        <select name="heard" onChange={(event) => setHeard(event.target.value as HeardValue | "")} value={heard}>
          <option value="">Choose one</option>
          {HEARD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {heard && HEARD_ASKS_WHO[heard] ? (
        <label>
          {HEARD_ASKS_WHO[heard]}
          <input maxLength={120} name="heardDetail" />
        </label>
      ) : null}
      {notice ? (
        <p className="form-error" role="status">
          {notice}
        </p>
      ) : null}
      {/* It said "Start 14-day trial", and the trial started two screens
          later, after a plan and a card: the next screen asked to start it
          again. This one makes the studio. */}
      <button
        className="button button-dark sign-in-submit"
        disabled={busy}
        type="submit"
      >
        {busy ? (
          "Creating your studio…"
        ) : (
          <>
            Continue <ArrowRight size={17} />
          </>
        )}
      </button>
    </form>
    </>
  );
}
