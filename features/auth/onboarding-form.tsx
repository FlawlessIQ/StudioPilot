"use client";
import { useState, type FormEvent } from "react";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { invalidateMembershipCache } from "@/lib/firebase/membership-cache";
import { requestBrandedAuthEmail } from "@/lib/auth/email-client";

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

export function OnboardingForm() {
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // P4/P7: distinct states so the wall can offer a resend, and success stops
  // the form from staying interactive (double-submit) while the redirect lands.
  const [phase, setPhase] = useState<"form" | "needs_verification" | "done">(
    "form",
  );
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">(
    "idle",
  );

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
            legalName: String(data.get("legalName")),
            timezone: String(data.get("timezone")),
            currency: String(data.get("currency")),
          }),
        },
      );
      const result = (await response.json()) as {
        error?: string;
        tenantId?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "Studio setup failed.");
      if (result.tenantId)
        window.localStorage.setItem(
          "studiohub.activeTenantId",
          result.tenantId,
        );
      // P7: terminal success, form stays disabled so a bounce can't invite a
      // second submit.
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
      window.location.assign("/studio/subscription");
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error ? caught.message : "Studio setup failed.",
      );
      setBusy(false);
    }
  }

  if (phase === "done") {
    return (
      <div className="command-success">
        <h2>Your studio is ready</h2>
        <p>Opening your workspace…</p>
      </div>
    );
  }

  if (phase === "needs_verification") {
    return (
      <div className="command-success">
        <h2>Verify your email first</h2>
        <p>
          Your studio is one step away. Confirm your email address, then come
          back and start your trial.
        </p>
        <button
          className="button button-dark"
          type="button"
          disabled={resendState !== "idle"}
          onClick={() => void resendVerification()}
        >
          {resendState === "sent"
            ? "Verification email sent"
            : resendState === "sending"
              ? "Sending…"
              : "Resend verification email"}
        </button>
        {resendState === "sent" ? (
          <p role="status">
            Sent. Open the link, then reload this page to continue.
          </p>
        ) : null}
        {notice ? (
          <p className="form-error" role="status">
            {notice}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form className="sign-in-form" onSubmit={submit}>
      <label>
        Studio name <span className="required-mark">Required</span>
        <input
          name="businessName"
          required
          minLength={2}
          placeholder="Alder & Muse Photography"
        />
      </label>
      <label>
        Legal business name <span className="required-mark">Required</span>
        <input
          name="legalName"
          required
          minLength={2}
          placeholder="Alder & Muse Photography LLC"
        />
      </label>
      <label>
        Timezone <span className="required-mark">Required</span>
        <select name="timezone" defaultValue="America/New_York">
          {TIMEZONES.map((zone) => (
            <option key={zone.value} value={zone.value}>
              {zone.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Currency <span className="required-mark">Required</span>
        <select name="currency" defaultValue="USD">
          <option value="USD">USD</option>
          <option value="CAD">CAD</option>
          <option value="GBP">GBP</option>
          <option value="EUR">EUR</option>
          <option value="AUD">AUD</option>
        </select>
      </label>
      {notice ? (
        <p className="form-error" role="status">
          {notice}
        </p>
      ) : null}
      <button
        className="button button-dark sign-in-submit"
        disabled={busy}
        type="submit"
      >
        {busy ? "Creating your studio…" : "Start 14-day trial"}
      </button>
    </form>
  );
}
