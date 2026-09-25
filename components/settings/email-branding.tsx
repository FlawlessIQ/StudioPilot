"use client";

import { useEffect, useState, type FormEvent } from "react";
import { doc, getDoc } from "firebase/firestore";
import { Check, Mail, Palette } from "lucide-react";
import { activeMembership } from "@/lib/firebase/active-membership";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { friendlyError } from "@/lib/ai/friendly-error";
import { LOGO_CONTENT_TYPES, uploadStudioLogo } from "@/lib/branding/logo-upload";

type Branding = {
  tenantId: string;
  brandName: string;
  primaryColor: string;
  logoUrl: string;
  replyTo: string;
};

const previewDefaults: Branding = {
  tenantId: "preview",
  brandName: "Your Studio",
  primaryColor: "#315F48",
  logoUrl: "",
  replyTo: "",
};

export function EmailBranding() {
  const [branding, setBranding] = useState<Branding>(previewDefaults);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(dataIsLive);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!dataIsLive) return;
      try {
        const { auth, firestore } = getFirebaseClient();
        const user = auth.currentUser;
        if (!user) throw new Error("Sign in to manage email branding.");
        const membership = await activeMembership(firestore, user.uid);
        const tenantId = String(membership.get("tenantId") ?? "");
        const tenant = await getDoc(doc(firestore, "tenants", tenantId));
        const emailBranding = tenant.get("emailBranding") as
          | Record<string, unknown>
          | undefined;
        if (active) {
          setBranding({
            tenantId,
            brandName: String(
              tenant.get("brandName") ?? tenant.get("businessName") ?? "",
            ),
            primaryColor: String(
              emailBranding?.primaryColor ?? "#315F48",
            ).toUpperCase(),
            logoUrl: String(emailBranding?.logoUrl ?? ""),
            replyTo: String(emailBranding?.replyTo ?? ""),
          });
        }
      } catch (caught: unknown) {
        if (active) {
          setNotice(
            friendlyError(caught, "Email branding is unavailable."),
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  function update(field: keyof Branding, value: string) {
    setBranding((current) => ({ ...current, [field]: value }));
  }

  /**
   * The upload writes into the same `logoUrl` the form already saves, so the
   * studio still presses Save and nothing about the command changes.
   */
  async function uploadLogo(file: File) {
    setUploading(true);
    setNotice(null);
    try {
      if (!dataIsLive || branding.tenantId === "preview") {
        setNotice("Preview mode: the logo would be uploaded and applied.");
        return;
      }
      const url = await uploadStudioLogo(branding.tenantId, file);
      update("logoUrl", url);
      setNotice("Logo uploaded. Save to apply it.");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That logo could not be uploaded."));
    } finally {
      setUploading(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      if (!dataIsLive) {
        setNotice("Preview saved for this session.");
        return;
      }
      const { auth } = getFirebaseClient();
      const user = auth.currentUser;
      if (!user) throw new Error("Sign in as the Studio Owner.");
      const appCheckToken = await getAppCheckToken();
      const response = await fetch("/api/functions/tenantBrandingCommand", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${await user.getIdToken()}`,
          ...(appCheckToken
            ? { "x-firebase-appcheck": appCheckToken }
            : {}),
        },
        body: JSON.stringify(branding),
      });
      const result = (await response.json()) as {
        error?: string;
        emailBranding?: { primaryColor?: string };
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Email branding could not be saved.");
      }
      setBranding((current) => ({
        ...current,
        primaryColor:
          result.emailBranding?.primaryColor ?? current.primaryColor,
      }));
      setNotice("Email branding saved. New messages will use this design.");
    } catch (caught: unknown) {
      setNotice(
        friendlyError(caught, "Email branding could not be saved."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="email-branding-layout"
      aria-labelledby="email-branding-title"
    >
      <form className="panel email-branding-form" onSubmit={save}>
        <div className="email-branding-heading">
          <span className="data-control-icon">
            <Palette aria-hidden="true" />
          </span>
          <div>
            <p className="eyebrow">Client communications</p>
            <h2 id="email-branding-title">Email branding</h2>
            <p>
              Applied to portal invitations, reminders, documents, payments,
              delivery messages, and account recovery.
            </p>
          </div>
        </div>

        <div className="email-branding-fields">
          <label>
            Studio name
            <input
              required
              minLength={2}
              maxLength={120}
              value={branding.brandName}
              onChange={(event) => update("brandName", event.target.value)}
            />
          </label>
          <label>
            Accent color
            <span className="color-field">
              <input
                aria-label="Choose accent color"
                type="color"
                value={branding.primaryColor}
                onChange={(event) =>
                  update("primaryColor", event.target.value.toUpperCase())
                }
              />
              <input
                aria-label="Accent color hex value"
                required
                pattern="#[0-9A-Fa-f]{6}"
                value={branding.primaryColor}
                onChange={(event) =>
                  update("primaryColor", event.target.value.toUpperCase())
                }
              />
            </span>
          </label>
          {/**
            * Upload, not a URL.
            *
            * This asked for a "Logo URL", which assumes the studio hosts
            * images somewhere and can paste a link to one. Most cannot, so
            * most had no logo at all — and the field reached emails only,
            * while the proposal PDF printed the studio name as plain text and
            * the client portal showed nothing.
            *
            * The field stays, because a studio that already has a hosted logo
            * should not be made to re-upload it, and because it is what the
            * upload writes into.
            */}
          <label>
            Your logo <span>(optional)</span>
            <input
              accept={LOGO_CONTENT_TYPES.join(",")}
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadLogo(file);
              }}
              type="file"
            />
            <span>
              {uploading
                ? "Uploading…"
                : "PNG, JPEG, WebP or SVG, under 2 MB. Appears on your proposals, your client portal and your emails."}
            </span>
          </label>
          {branding.logoUrl ? (
            <label>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="Your studio logo"
                className="branding-logo-preview"
                src={branding.logoUrl}
                style={{ maxHeight: 64, maxWidth: 220 }}
              />
              <button
                className="ghost-button"
                onClick={() => update("logoUrl", "")}
                type="button"
              >
                Remove logo
              </button>
            </label>
          ) : null}
          <label>
            Logo URL <span>(optional — set by the upload above)</span>
            <input
              type="url"
              inputMode="url"
              placeholder="https://yourstudio.com/logo.png"
              value={branding.logoUrl}
              onChange={(event) => update("logoUrl", event.target.value)}
            />
          </label>
          <label>
            Reply-to email <span>(optional)</span>
            <input
              type="email"
              inputMode="email"
              placeholder="hello@yourstudio.com"
              value={branding.replyTo}
              onChange={(event) => update("replyTo", event.target.value)}
            />
          </label>
        </div>

        <div className="email-branding-actions">
          <button
            className="button button-dark"
            type="submit"
            disabled={loading || saving}
          >
            {saving ? "Saving…" : "Save email branding"}
          </button>
          {notice ? (
            <p className="form-notice" role="status">
              {notice}
            </p>
          ) : null}
        </div>
      </form>

      <aside className="email-preview" aria-label="Branded email preview">
        <div
          className="email-preview-accent"
          style={{ backgroundColor: branding.primaryColor }}
        />
        <div className="email-preview-body">
          <div
            className="email-preview-mark"
            style={{ backgroundColor: branding.primaryColor }}
          >
            {branding.brandName.trim().slice(0, 1).toUpperCase() || "S"}
          </div>
          <p className="eyebrow">Email preview</p>
          <h3>{branding.brandName || "Your Studio"}</h3>
          <p className="email-preview-greeting">Hi Jordan,</p>
          <h4>Your client portal is ready</h4>
          <p>
            Everything for your project now has one clear, private home.
          </p>
          <span
            className="email-preview-button"
            style={{ backgroundColor: branding.primaryColor }}
          >
            Open your portal
          </span>
          <ul>
            <li>
              <Check aria-hidden="true" /> Secure, project-specific access
            </li>
            <li>
              <Check aria-hidden="true" /> One place for every next step
            </li>
          </ul>
        </div>
        <footer>
          <Mail aria-hidden="true" />
          Replies go to {branding.replyTo || "your studio inbox"}
        </footer>
      </aside>
    </section>
  );
}
