"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Building2, LoaderCircle } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { activeMembership } from "@/lib/firebase/active-membership";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  IDENTITY_SCOPE,
  normalizeSlug,
  slugChangeConsequence,
  slugProblem,
  SUPPORTED_CURRENCIES,
} from "@/features/tenants/identity";

/**
 * What the studio calls itself, where it is, and its public inquiry address.
 *
 * All six of these were written in exactly one place — `saas/onboarding.ts` —
 * so they were frozen at signup. A studio that typed its legal name wrong had
 * it on every contract; one that moved cities had every new schedule defaulting
 * to the wrong timezone; and the public inquiry URL stayed whatever signup
 * generated, `flawlessiq-14313514`.
 *
 * Each field says what it affects, because a studio that cannot tell whether a
 * change rewrites history will not make the change. All six are defaults for
 * *new* records: projects carry their own timezone, snapshots and invoices
 * their own currency, and a signed contract keeps the name it was signed under.
 */

type Identity = {
  tenantId: string;
  legalName: string;
  businessName: string;
  timezone: string;
  currency: string;
  publicSlug: string;
};

const EMPTY: Identity = {
  tenantId: "preview",
  legalName: "",
  businessName: "",
  timezone: "America/New_York",
  currency: "USD",
  publicSlug: "",
};

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Australia/Sydney",
];

export function StudioIdentitySettings() {
  const [identity, setIdentity] = useState<Identity>(EMPTY);
  const [originalSlug, setOriginalSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (!dataIsLive) return;
        const { auth, firestore } = getFirebaseClient();
        const user = auth.currentUser;
        if (!user) return;
        const membership = await activeMembership(firestore, user.uid);
        const tenantId = String(membership.get("tenantId") ?? "");
        const tenant = await getDoc(doc(firestore, "tenants", tenantId));
        if (!active) return;
        const text = (field: string, fallback = "") =>
          typeof tenant.get(field) === "string"
            ? String(tenant.get(field))
            : fallback;
        const slug = text("publicSlug");
        setIdentity({
          tenantId,
          legalName: text("legalName"),
          businessName: text("businessName", text("brandName")),
          timezone: text("timezone", "America/New_York"),
          currency: text("currency", "USD"),
          publicSlug: slug,
        });
        setOriginalSlug(slug);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const proposedSlug = normalizeSlug(identity.publicSlug);
  const slugIssue = identity.publicSlug ? slugProblem(proposedSlug) : null;
  const slugMoves = slugChangeConsequence(originalSlug, proposedSlug);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      if (!dataIsLive) {
        setNotice("Preview: nothing was saved.");
        return;
      }
      if (slugIssue) throw new Error(slugIssue);
      const { auth } = getFirebaseClient();
      const user = auth.currentUser;
      if (!user) throw new Error("Sign in as the Studio Owner.");
      const appCheckToken = await getAppCheckToken();
      const response = await fetch("/api/functions/tenantIdentityCommand", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${await user.getIdToken()}`,
          ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
        },
        body: JSON.stringify({ ...identity, publicSlug: proposedSlug }),
      });
      const result = (await response.json()) as {
        error?: string;
        publicSlug?: string;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "IDENTITY_UPDATE_FAILED");
      }
      const saved = result.publicSlug ?? proposedSlug;
      setIdentity((current) => ({ ...current, publicSlug: saved }));
      setOriginalSlug(saved);
      setNotice("Studio details saved.");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "Studio details could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel studio-identity">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Your studio</p>
          <h2>Studio details</h2>
          <p>
            The name on your agreements, where your jobs default to, and the
            address of your inquiry form.
          </p>
        </div>
        <Building2 aria-hidden="true" />
      </div>
      {loading ? (
        <p className="form-notice">
          <LoaderCircle className="spin" size={14} /> Loading your details…
        </p>
      ) : (
        <form onSubmit={(event) => void save(event)}>
          <label>
            Legal business name
            <input
              maxLength={200}
              onChange={(event) =>
                setIdentity((c) => ({ ...c, legalName: event.target.value }))
              }
              required
              value={identity.legalName}
            />
            <small>{IDENTITY_SCOPE.legalName}</small>
          </label>
          <label>
            Workspace name
            <input
              maxLength={200}
              onChange={(event) =>
                setIdentity((c) => ({ ...c, businessName: event.target.value }))
              }
              required
              value={identity.businessName}
            />
            <small>{IDENTITY_SCOPE.businessName}</small>
          </label>
          <label>
            Timezone
            <select
              onChange={(event) =>
                setIdentity((c) => ({ ...c, timezone: event.target.value }))
              }
              value={identity.timezone}
            >
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace("_", " ")}
                </option>
              ))}
            </select>
            <small>{IDENTITY_SCOPE.timezone}</small>
          </label>
          <label>
            Currency
            <select
              onChange={(event) =>
                setIdentity((c) => ({ ...c, currency: event.target.value }))
              }
              value={identity.currency}
            >
              {SUPPORTED_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <small>{IDENTITY_SCOPE.currency}</small>
          </label>
          <label className="studio-identity-span">
            Public inquiry address
            <span className="studio-identity-slug">
              <em>/inquiry?studio=</em>
              <input
                maxLength={60}
                onChange={(event) =>
                  setIdentity((c) => ({
                    ...c,
                    publicSlug: event.target.value,
                  }))
                }
                required
                value={identity.publicSlug}
              />
            </span>
            <small>
              {slugIssue ??
                slugMoves ??
                "Where clients reach your inquiry form. Old addresses keep working."}
            </small>
          </label>
          <button
            className="button button-dark"
            disabled={saving || Boolean(slugIssue)}
            type="submit"
          >
            {saving ? <LoaderCircle className="spin" size={15} /> : null}
            {saving ? "Saving…" : "Save studio details"}
          </button>
          {notice ? (
            <p className="form-notice" role="status">
              {notice}
            </p>
          ) : null}
        </form>
      )}
    </section>
  );
}
