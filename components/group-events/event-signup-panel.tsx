"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Copy, LoaderCircle, Mail, MessageSquareText, Plus, Printer, QrCode, Settings2, Smartphone, Trash2 } from "lucide-react";
import QRCode from "qrcode";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { normaliseStudioInvoiceSettings } from "@/features/billing/studio-invoice-settings";
import {
  EVENT_PAYMENT_LABEL,
  EVENT_PAYMENT_SHORT,
  EVENT_PAYMENT_METHODS,
  EVENT_SIGNUP_LIMITS,
  emailsFrom,
  eventPrice,
  normaliseEventSignup,
  signupTextMessage,
  smsHref,
  type EventPaymentMethod,
  type EventSignupConfig,
} from "@/features/group-events/signup";
import { friendlyError } from "@/lib/ai/friendly-error";
import { inviteGroupEventParents, resetGroupEventLink, setGroupEventSignup } from "@/lib/group-events/commands";

/**
 * The event's sign-up link, on the roster (docs/group-event-signup-plan-2026-10-10.md).
 *
 * The studio sets the packages and the ways parents may pay, then gets the
 * link to parents: a QR code (on screen or a printed sign at the field),
 * the link copied, an email to a pasted list, or a text from its own phone —
 * StudioCue never sends texts (Conor, 2026-10-10). Sign-ups land on the
 * roster as they happen.
 */

const appOrigin = () =>
  (process.env.NEXT_PUBLIC_APP_URL ?? (typeof window === "undefined" ? "" : window.location.origin)).replace(/\/$/, "");

export const eventSignupUrl = (token: string) => `${appOrigin()}/e/${token}`;

/** The QR as an SVG string, or null while it's drawn. */
export function useQrSvg(url: string | null): string | null {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    void QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then((drawn) => {
      if (live) setSvg(drawn);
    });
    return () => {
      live = false;
    };
  }, [url]);
  return url ? svg : null;
}

export function QrImage({ url, label }: { url: string; label: string }) {
  const svg = useQrSvg(url);
  if (!svg) return <div aria-label={label} className="event-qr is-loading" role="img" />;
  // The library's own SVG: a path and a background, nothing a parent typed.
  return <div aria-label={label} className="event-qr" dangerouslySetInnerHTML={{ __html: svg }} role="img" />;
}

const stateLabel = (config: EventSignupConfig) => {
  if (!config.token) return "Not set up";
  if (!config.open) return "Closed";
  if (config.closesAt && Date.parse(config.closesAt) <= Date.now()) return "Closed";
  return "Open";
};

export function EventSignupPanel({
  projectId,
  project,
  signedUp,
}: {
  projectId: string;
  project: { name?: unknown; groupEvent?: unknown } | null;
  /** Sign-ups on the roster now, for the capacity line. */
  signedUp: number;
}) {
  const workspace = useWorkspace();
  const config = useMemo(() => normaliseEventSignup(project?.groupEvent), [project?.groupEvent]);
  const eventName = typeof project?.name === "string" && project.name.trim() ? project.name.trim() : "the event";
  const [sheet, setSheet] = useState<"settings" | "qr" | "email" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const url = config.token ? eventSignupUrl(config.token) : null;
  const state = stateLabel(config);

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(done);
    } catch {
      setNotice(null);
      setError("Your browser didn't allow copying. Select the link and copy it.");
    }
  }

  async function text() {
    if (!url) return;
    const message = signupTextMessage({ studioName: workspace.tenantName, eventName, url });
    setError(null);
    // The studio's own phone: its share sheet, or Messages with the text written.
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text: message });
        return;
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
      }
    }
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      window.location.href = smsHref(message);
      return;
    }
    await copy(message, "Copied the text. Paste it into a message from your phone.");
  }

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      await resetGroupEventLink(projectId);
      refreshTenantRecords("projects");
      setConfirmReset(false);
      setNotice("New link made. The old link and QR code no longer work, so share this one.");
    } catch (caught) {
      setError(friendlyError(caught, "The new link couldn't be made. Try again."));
    } finally {
      setBusy(false);
    }
  }

  if (!config.token) {
    return (
      <div className="event-signup-panel">
        <p>
          <strong>Let parents sign up themselves.</strong>{" "}
          {"Set your packages and how parents can pay, then send the link ahead of time or put a QR code up at the field."}
        </p>
        <div className="participant-roster-actions">
          <button className="button button-sm button-dark" onClick={() => setSheet("settings")} type="button">
            <Settings2 aria-hidden size={14} /> Set up sign-up
          </button>
        </div>
        <EventSignupSettingsSheet
          config={config}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            setNotice("Sign-up is set up. Share the link or show the QR code.");
          }}
          open={sheet === "settings"}
          projectId={projectId}
        />
        {notice ? <p className="form-notice" role="status">{notice}</p> : null}
      </div>
    );
  }

  return (
    <div className="event-signup-panel">
      <header>
        <span>
          <p className="eyebrow">Sign-up link</p>
          <strong>
            {state}
            {config.capacity ? ` · ${signedUp} of ${config.capacity} places taken` : ""}
          </strong>
        </span>
        <button className="button button-sm button-light" onClick={() => setSheet("settings")} type="button">
          <Settings2 aria-hidden size={14} /> Edit
        </button>
      </header>
      <p className="event-signup-panel-summary">
        {config.options.map((option) => `${option.name} ${eventPrice(option.priceCents)}`).join(" · ")}
        <br />
        <small>Pay by {config.methods.map((method) => EVENT_PAYMENT_SHORT[method]).join(", ")}</small>
      </p>
      {url ? <p className="event-signup-panel-link">{url}</p> : null}
      <div className="participant-roster-actions">
        <button className="button button-sm button-dark" onClick={() => setSheet("qr")} type="button">
          <QrCode aria-hidden size={14} /> QR code
        </button>
        <button className="button button-sm button-light" onClick={() => url && void copy(url, "Link copied.")} type="button">
          <Copy aria-hidden size={14} /> Copy link
        </button>
        <button className="button button-sm button-light" disabled={state !== "Open"} onClick={() => setSheet("email")} type="button">
          <Mail aria-hidden size={14} /> Email parents
        </button>
        <button className="button button-sm button-light" onClick={() => void text()} type="button">
          <MessageSquareText aria-hidden size={14} /> Text from your phone
        </button>
        <Link className="button button-sm button-light" href={`/studio/projects/${projectId}/field`}>
          <Smartphone aria-hidden size={14} /> Field mode
        </Link>
      </div>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <EventSignupSettingsSheet
        config={config}
        onClose={() => setSheet(null)}
        onSaved={() => {
          setSheet(null);
          setNotice("Saved. Parents see the change the next time they open the link.");
        }}
        open={sheet === "settings"}
        projectId={projectId}
      />
      <SheetDialog label="Sign-up QR code" onClose={() => setSheet(null)} open={sheet === "qr"}>
        <div className="record-sheet event-qr-sheet">
          <header>
            <p className="eyebrow">Sign-up</p>
            <h3>Scan to sign up</h3>
            <p>Parents scan this with their phone camera, pick a package and choose how they&rsquo;ll pay.</p>
          </header>
          {url ? <QrImage label={`QR code for ${url}`} url={url} /> : null}
          <p className="event-signup-panel-link">{url}</p>
          {confirmReset ? (
            <div className="event-signup-reset">
              <p>The link and QR code you&rsquo;ve shared will stop working. Parents already signed up keep their orders.</p>
              <div className="participant-roster-actions">
                <button className="button button-sm button-light" onClick={() => setConfirmReset(false)} type="button">
                  Keep this link
                </button>
                <button className="button button-sm button-dark" disabled={busy} onClick={() => void reset()} type="button">
                  {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : null}
                  Make a new link
                </button>
              </div>
            </div>
          ) : null}
          <footer>
            {confirmReset ? null : (
              <button className="button button-light" onClick={() => setConfirmReset(true)} type="button">
                New link
              </button>
            )}
            <a className="button button-light" href={`/studio/projects/${projectId}/sign`} rel="noopener" target="_blank">
              <Printer aria-hidden size={14} /> Print a sign
            </a>
            <button className="button button-dark" onClick={() => setSheet(null)} type="button">
              Done
            </button>
          </footer>
        </div>
      </SheetDialog>
      <InviteParentsSheet
        onClose={() => setSheet(null)}
        onSent={(message) => {
          setSheet(null);
          setNotice(message);
        }}
        open={sheet === "email"}
        projectId={projectId}
      />
    </div>
  );
}

function InviteParentsSheet({
  open,
  projectId,
  onClose,
  onSent,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const [list, setList] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { emails, rejected } = emailsFrom(list);

  async function send() {
    if (!emails.length) {
      setError("Paste at least one email address.");
      return;
    }
    if (emails.length > 200) {
      setError("Up to 200 parents at a time. Send the rest in a second batch.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { persisted, result } = await inviteGroupEventParents(projectId, emails);
      setList("");
      if (!persisted) return onSent("Preview mode: nothing was sent.");
      const { invited = emails.length, alreadyInvited = 0 } = result as { invited?: number; alreadyInvited?: number };
      onSent(
        `${invited} ${invited === 1 ? "parent" : "parents"} emailed.${alreadyInvited ? ` ${alreadyInvited} already had this link, so weren't emailed again.` : ""}`,
      );
    } catch (caught) {
      setError(friendlyError(caught, "The invites didn't send. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetDialog label="Email parents the sign-up link" onClose={onClose} open={open}>
      <div className="record-sheet">
        <header>
          <p className="eyebrow">Sign-up</p>
          <h3>Email parents the link</h3>
          <p>Paste parents&rsquo; emails from a team list or spreadsheet. Each gets one email with the link; nobody is emailed twice.</p>
        </header>
        <div className="record-sheet-fields">
          <label>
            Parents&rsquo; emails
            <textarea
              onChange={(event) => setList(event.target.value)}
              placeholder={"dana@example.com, sam@example.com\nor one per line"}
              rows={6}
              value={list}
            />
          </label>
          <small>
            {`${emails.length} ${emails.length === 1 ? "email" : "emails"} found${
              rejected.length ? ` · skipped ${rejected.length} that ${rejected.length === 1 ? "isn't an email" : "aren't emails"}` : ""
            }`}
          </small>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <footer>
          <button className="button button-light" onClick={onClose} type="button">
            Close
          </button>
          <button className="button button-dark" disabled={busy || !emails.length} onClick={() => void send()} type="button">
            {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : <Mail aria-hidden size={14} />}
            Email {emails.length || ""} {emails.length === 1 ? "parent" : "parents"}
          </button>
        </footer>
      </div>
    </SheetDialog>
  );
}

type OptionDraft = { id: string; name: string; price: string; description: string };

const newOptionId = () => `opt_${Math.random().toString(36).slice(2, 10)}`;
const centsFrom = (price: string): number | null => {
  const number = Number(price.replace(/[$,\s]/g, ""));
  return price.trim() && Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : null;
};
/** A datetime-local value from an ISO time, in this browser's zone. */
const localInput = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

function EventSignupSettingsSheet({
  open,
  projectId,
  config,
  onClose,
  onSaved,
}: {
  open: boolean;
  projectId: string;
  config: EventSignupConfig;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <SheetDialog label="Sign-up settings" onClose={onClose} open={open} width="wide">
      {/* Mounted per opening, so each one starts from what's saved. */}
      {open ? <EventSignupSettingsForm config={config} onClose={onClose} onSaved={onSaved} projectId={projectId} /> : null}
    </SheetDialog>
  );
}

const draftOptions = (config: EventSignupConfig): OptionDraft[] =>
  config.options.length
    ? config.options.map((option) => ({
        id: option.id,
        name: option.name,
        price: (option.priceCents / 100).toFixed(option.priceCents % 100 ? 2 : 0),
        description: option.description ?? "",
      }))
    : [
        { id: newOptionId(), name: "", price: "", description: "" },
        { id: newOptionId(), name: "", price: "", description: "" },
      ];

function EventSignupSettingsForm({
  projectId,
  config,
  onClose,
  onSaved,
}: {
  projectId: string;
  config: EventSignupConfig;
  onClose: () => void;
  onSaved: () => void;
}) {
  const workspace = useWorkspace();
  const ownerOrAdmin = workspace.role === "studio_owner" || workspace.role === "studio_admin";
  const { records: billing } = useTenantDocuments("billingSettings", { enabled: ownerOrAdmin });
  const studioPayLink = useMemo(
    () => normaliseStudioInvoiceSettings(billing?.find((record) => record.tenantId === workspace.tenantId) ?? null).payLinkUrl,
    [billing, workspace.tenantId],
  );
  const [options, setOptions] = useState<OptionDraft[]>(() => draftOptions(config));
  const [methods, setMethods] = useState<EventPaymentMethod[]>(() => (config.methods.length ? config.methods : ["cash", "check"]));
  const [venmoHandle, setVenmoHandle] = useState(config.venmoHandle ? `@${config.venmoHandle}` : "");
  const [zelleTo, setZelleTo] = useState(config.zelleTo ?? "");
  const [checkPayableTo, setCheckPayableTo] = useState(config.checkPayableTo ?? "");
  // Until the studio types one, its own pay link from Invoices and payments.
  const [payLinkTyped, setPayLinkTyped] = useState<string | null>(config.payLinkUrl);
  const payLinkUrl = payLinkTyped ?? studioPayLink ?? "";
  const setPayLinkUrl = (value: string) => setPayLinkTyped(value);
  const [isOpen, setIsOpen] = useState(config.token ? config.open : true);
  const [closesAt, setClosesAt] = useState(localInput(config.closesAt));
  const [capacity, setCapacity] = useState(config.capacity ? String(config.capacity) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (method: EventPaymentMethod) =>
    setMethods((current) =>
      current.includes(method)
        ? current.filter((item) => item !== method)
        : EVENT_PAYMENT_METHODS.filter((item) => item === method || current.includes(item)),
    );

  async function save() {
    const named = options.filter((option) => option.name.trim() || option.price.trim());
    if (!named.length) return setError("Add at least one package, with a name and a price.");
    for (const option of named) {
      if (!option.name.trim()) return setError("Every package needs a name.");
      const cents = centsFrom(option.price);
      if (cents === null || cents > EVENT_SIGNUP_LIMITS.maxPriceCents)
        return setError(`Give “${option.name.trim()}” a price in dollars, like 45 or 45.50.`);
    }
    if (!methods.length) return setError("Choose at least one way parents can pay.");
    const capacityNumber = capacity.trim() ? Number(capacity) : null;
    if (capacityNumber !== null && (!Number.isSafeInteger(capacityNumber) || capacityNumber < 1))
      return setError("The limit is a whole number of sign-ups, or leave it blank.");
    const closes = closesAt ? new Date(closesAt) : null;
    if (closes && Number.isNaN(closes.valueOf())) return setError("Check the closing time.");
    setBusy(true);
    setError(null);
    try {
      await setGroupEventSignup(projectId, {
        options: named.map((option) => ({
          id: option.id,
          name: option.name.trim(),
          priceCents: centsFrom(option.price) ?? 0,
          description: option.description.trim() || null,
        })),
        methods,
        venmoHandle: methods.includes("venmo") ? venmoHandle.trim() || null : null,
        zelleTo: methods.includes("zelle") ? zelleTo.trim() || null : null,
        checkPayableTo: methods.includes("check") ? checkPayableTo.trim() || null : null,
        payLinkUrl: methods.includes("pay_link") ? payLinkUrl.trim() || null : null,
        open: isOpen,
        closesAt: closes ? closes.toISOString() : null,
        capacity: capacityNumber,
      });
      refreshTenantRecords("projects");
      onSaved();
    } catch (caught) {
      setError(friendlyError(caught, "The sign-up settings didn't save. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="record-sheet event-signup-settings">
      <header>
        <p className="eyebrow">Sign-up</p>
        <h3>Packages and payment</h3>
        <p>What parents can choose, and how they can pay you. Prices are what parents pay; no tax is added.</p>
      </header>
      <fieldset className="event-signup-settings-group">
        <legend>Packages</legend>
        {options.map((option, index) => (
          <div className="event-signup-settings-option" key={option.id}>
            <label className="event-signup-settings-name">
              Name
              <input
                maxLength={EVENT_SIGNUP_LIMITS.optionName}
                onChange={(event) =>
                  setOptions((current) => current.map((item, at) => (at === index ? { ...item, name: event.target.value } : item)))
                }
                placeholder={index === 0 ? "Digital set" : index === 1 ? "Print package" : "Package name"}
                value={option.name}
              />
            </label>
            <label className="event-signup-settings-price">
              Price ($)
              <input
                inputMode="decimal"
                onChange={(event) =>
                  setOptions((current) => current.map((item, at) => (at === index ? { ...item, price: event.target.value } : item)))
                }
                placeholder="45"
                value={option.price}
              />
            </label>
            <label className="event-signup-settings-detail">
              <span>
                What&rsquo;s included <small>optional</small>
              </span>
              <input
                maxLength={EVENT_SIGNUP_LIMITS.optionDescription}
                onChange={(event) =>
                  setOptions((current) =>
                    current.map((item, at) => (at === index ? { ...item, description: event.target.value } : item)),
                  )
                }
                placeholder="What they get"
                value={option.description}
              />
            </label>
            {options.length > 1 ? (
              <button
                aria-label={`Remove ${option.name || "this package"}`}
                className="icon-button"
                onClick={() => setOptions((current) => current.filter((_, at) => at !== index))}
                type="button"
              >
                <Trash2 aria-hidden size={16} />
              </button>
            ) : null}
          </div>
        ))}
        {options.length < EVENT_SIGNUP_LIMITS.maxOptions ? (
          <button
            className="button button-sm button-light"
            onClick={() => setOptions((current) => [...current, { id: newOptionId(), name: "", price: "", description: "" }])}
            type="button"
          >
            <Plus aria-hidden size={14} /> Add a package
          </button>
        ) : null}
      </fieldset>

      <fieldset className="event-signup-settings-group">
        <legend>How parents can pay</legend>
        {EVENT_PAYMENT_METHODS.map((method) => (
          <div className="event-signup-settings-method" key={method}>
            <label className="participant-roster-check">
              <input checked={methods.includes(method)} onChange={() => toggle(method)} type="checkbox" />
              {EVENT_PAYMENT_LABEL[method]}
            </label>
            {method === "venmo" && methods.includes("venmo") ? (
              <label>
                Your Venmo username
                <input onChange={(event) => setVenmoHandle(event.target.value)} placeholder="@YourStudio" value={venmoHandle} />
              </label>
            ) : null}
            {method === "zelle" && methods.includes("zelle") ? (
              <label>
                Zelle to (email or phone)
                <input
                  maxLength={EVENT_SIGNUP_LIMITS.zelleTo}
                  onChange={(event) => setZelleTo(event.target.value)}
                  placeholder="billing@yourstudio.com"
                  value={zelleTo}
                />
              </label>
            ) : null}
            {method === "check" && methods.includes("check") ? (
              <label>
                <span>
                  Checks payable to <small>optional</small>
                </span>
                <input
                  maxLength={EVENT_SIGNUP_LIMITS.checkPayableTo}
                  onChange={(event) => setCheckPayableTo(event.target.value)}
                  placeholder="Your Studio LLC"
                  value={checkPayableTo}
                />
              </label>
            ) : null}
            {method === "pay_link" && methods.includes("pay_link") ? (
              <label>
                Your payment link (Square, PayPal, Stripe…)
                <input inputMode="url" onChange={(event) => setPayLinkUrl(event.target.value)} placeholder="https://" value={payLinkUrl} />
              </label>
            ) : null}
          </div>
        ))}
      </fieldset>

      <fieldset className="event-signup-settings-group">
        <legend>Sign-up</legend>
        <label className="participant-roster-check">
          <input checked={isOpen} onChange={(event) => setIsOpen(event.target.checked)} type="checkbox" />
          Taking sign-ups
        </label>
        <div className="record-sheet-fields">
          <label>
            <span>
              Close sign-up at <small>optional</small>
            </span>
            <input onChange={(event) => setClosesAt(event.target.value)} type="datetime-local" value={closesAt} />
          </label>
          <label>
            <span>
              Limit <small>optional</small>
            </span>
            <input inputMode="numeric" onChange={(event) => setCapacity(event.target.value)} placeholder="No limit" value={capacity} />
          </label>
        </div>
      </fieldset>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <footer>
        <button className="button button-light" onClick={onClose} type="button">
          Close
        </button>
        <button className="button button-dark" disabled={busy} onClick={() => void save()} type="button">
          {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : null}
          Save
        </button>
      </footer>
    </div>
  );
}
