"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, ExternalLink, LoaderCircle, MailCheck, Send } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { sendCommunicationsCommand } from "@/lib/communications/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  FORM_SOURCES,
  GMAIL_FORWARDING_SETTINGS,
  OUTLOOK_RULES,
  gmailFilterQuery,
  gmailSearchLink,
  type FormSource,
} from "@/features/intake/forwarding-filters";

/**
 * Capture inquiries from the studio's own inbox, with nothing changed on its
 * website.
 *
 * Three steps, each answered by the product rather than by the studio:
 *  1. Which mailbox — detected from the domain's MX records.
 *  2. The filter — the exact Gmail search for the builders they use, and the
 *     forwarding confirmation code shown here the moment Gmail sends it.
 *  3. A test — the next capture is shown field by field, and the studio's
 *     corrections become how that form is read from then on.
 */

type TestField = { label: string; normalisedLabel: string; value: string; key: string | null };

type Setup = {
  address: string | null;
  mailbox: { email: string; domain: string; provider: string } | null;
  forwardingConfirmation: { code?: string; link?: string; forAddress?: string; receivedAt?: string } | null;
  lastCaptureAt: string | null;
  testWindowUntil: string | null;
  lastTest: {
    id: string;
    receivedAt: string;
    builderLabel: string;
    formName: string | null;
    formKey: string;
    subject: string;
    fields: TestField[];
    verdict: string;
  } | null;
  forms: Array<{ formKey: string; label: string | null; mappedFields: number }>;
};

const PROVIDER_LABEL: Record<string, string> = {
  gmail: "Gmail",
  google_workspace: "Google Workspace (Gmail)",
  outlook_com: "Outlook.com",
  microsoft_365: "Microsoft 365 (Outlook)",
  other: "another provider",
};

const FIELD_CHOICES: Array<[string, string]> = [
  ["fullName", "Name"],
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["partnerName", "Partner"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["eventDate", "Date"],
  ["eventType", "Event type"],
  ["venue", "Venue"],
  ["city", "City"],
  ["ceremonyTime", "Ceremony time"],
  ["guestCount", "Guests"],
  ["budget", "Budget"],
  ["services", "Services"],
  ["referralSource", "How they found you"],
  ["message", "Message"],
  ["ignore", "Ignore this field"],
];

function isGoogle(provider: string | undefined) {
  return provider === "gmail" || provider === "google_workspace";
}

function isMicrosoft(provider: string | undefined) {
  return provider === "microsoft_365" || provider === "outlook_com";
}

function Copyable({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="button button-light button-sm"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        });
      }}
      type="button"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied" : label}
    </button>
  );
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Whether an ISO time is still ahead. */
function isAhead(iso: string | null | undefined): boolean {
  return Boolean(iso && Date.parse(iso) > Date.now());
}

/** Whether an ISO time is within the last day. */
function withinDay(iso: string | null | undefined): boolean {
  return Boolean(iso && Date.now() - Date.parse(iso) < 24 * 60 * 60 * 1000);
}

export function LeadCaptureSetup() {
  const workspace = useWorkspace();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<FormSource[]>([]);
  const [mailbox, setMailbox] = useState("");
  // Bumped to read again: after a change, a "check again", or on a timer.
  const [reads, setReads] = useState(0);
  const [mailboxQuery, setMailboxQuery] = useState<string | null>(null);
  const load = useCallback((mailboxOverride?: string) => {
    if (mailboxOverride !== undefined) setMailboxQuery(mailboxOverride || null);
    setReads((count) => count + 1);
  }, []);

  useEffect(() => {
    if (!workspace.tenantId) return;
    let active = true;
    sendCommunicationsCommand({
      type: "getLeadCaptureSetup",
      idempotencyKey: `lead_capture_setup_${reads}`,
      input: { mailbox: mailboxQuery },
    })
      .then((result) => {
        if (active && result.mode === "live") setSetup(result.payload as Setup);
      })
      .catch((caught: unknown) => {
        if (active) setError(friendlyError(caught, "Inquiry capture settings could not be loaded."));
      });
    return () => {
      active = false;
    };
  }, [workspace.tenantId, reads, mailboxQuery]);

  // While a test is running, look again every few seconds so the step
  // completes on screen without a refresh.
  const waiting = isAhead(setup?.testWindowUntil);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => load(), 5000);
    return () => window.clearInterval(timer);
  }, [waiting, load]);

  const query = useMemo(() => gmailFilterQuery(sources), [sources]);

  if (error) return <p className="form-notice">{error}</p>;
  if (!setup?.address) return null;
  const provider = setup.mailbox?.provider;

  return (
    <div className="lead-capture-setup">
      <header>
        <MailCheck aria-hidden="true" size={18} />
        <div>
          <h3>Capture inquiries from your inbox</h3>
          <p>
            Your website form already emails you. Forward those emails here and
            each one becomes an inquiry, filled in, with the date checked and a
            reply drafted. Nothing changes on your website.
          </p>
          <small>
            Last inquiry captured: <strong>{ago(setup.lastCaptureAt)}</strong>
          </small>
        </div>
      </header>

      <section>
        <h4>1. Your inbox</h4>
        {setup.mailbox ? (
          <p>
            <strong>{setup.mailbox.email}</strong> uses {PROVIDER_LABEL[provider ?? "other"]}.
          </p>
        ) : null}
        <form
          className="lead-capture-inline"
          onSubmit={(event) => {
            event.preventDefault();
            load(mailbox);
          }}
        >
          <input
            aria-label="The email address your website form sends to"
            onChange={(event) => setMailbox(event.target.value)}
            placeholder="Where does your form send? e.g. hello@yourstudio.com"
            type="email"
            value={mailbox}
          />
          <button className="button button-light button-sm" type="submit">Check</button>
        </form>
      </section>

      <section>
        <h4>2. Forward only your inquiries</h4>
        <p>Which of these send you inquiries?</p>
        <div className="lead-capture-sources">
          {FORM_SOURCES.map((source) => (
            <label key={source.key}>
              <input
                checked={sources.includes(source.key)}
                onChange={(event) =>
                  setSources(
                    event.target.checked
                      ? [...sources, source.key]
                      : sources.filter((value) => value !== source.key),
                  )
                }
                type="checkbox"
              />
              {source.label}
            </label>
          ))}
        </div>
        {isMicrosoft(provider) ? (
          <ol>
            <li>
              In Outlook, open <a href={OUTLOOK_RULES} rel="noreferrer" target="_blank">Rules <ExternalLink size={12} /></a> and add a rule: when the sender&apos;s address includes your form&apos;s sender, <em>Forward to</em> <code>{setup.address}</code>.
            </li>
            {provider === "microsoft_365" ? (
              <li>
                Microsoft 365 blocks forwarding outside your organisation by
                default. If the rule does nothing, ask whoever manages your
                email to allow automatic forwarding for your mailbox.
              </li>
            ) : null}
          </ol>
        ) : (
          <ol>
            <li>
              In Gmail, open <a href={GMAIL_FORWARDING_SETTINGS} rel="noreferrer" target="_blank">Forwarding settings <ExternalLink size={12} /></a> → <em>Add a forwarding address</em> → paste <code>{setup.address}</code> <Copyable label="Copy address" value={setup.address} />
            </li>
            <li>
              Gmail sends a confirmation code to that address. It appears here:{" "}
              {setup.forwardingConfirmation?.code ? (
                <span className="lead-capture-code">
                  <strong>{setup.forwardingConfirmation.code}</strong>{" "}
                  <Copyable label="Copy code" value={setup.forwardingConfirmation.code} />
                  {setup.forwardingConfirmation.link ? (
                    <a className="button button-light button-sm" href={setup.forwardingConfirmation.link} rel="noreferrer" target="_blank">
                      Or confirm in Gmail <ExternalLink size={12} />
                    </a>
                  ) : null}
                </span>
              ) : (
                <span className="lead-capture-waiting">
                  <LoaderCircle className="spin" size={14} /> waiting for Gmail…{" "}
                  <button className="button button-light button-sm" onClick={() => load()} type="button">Check again</button>
                </span>
              )}
            </li>
            <li>
              {query ? (
                <>
                  Make a filter from this search — open it, then the search
                  options ▾ → <em>Create filter</em> → <em>Forward it to</em> your StudioCue address:
                  <span className="lead-capture-query">
                    <code>{query}</code>
                    <Copyable label="Copy search" value={query} />
                    <a className="button button-light button-sm" href={gmailSearchLink(query)} rel="noreferrer" target="_blank">
                      Open in Gmail <ExternalLink size={12} />
                    </a>
                  </span>
                </>
              ) : (
                "Pick where your inquiries come from above and we'll write the Gmail filter for you."
              )}
            </li>
          </ol>
        )}
        {!isGoogle(provider) && !isMicrosoft(provider) && setup.mailbox ? (
          <p className="form-notice">
            Set up a rule in your email that forwards your form&apos;s
            notifications to <code>{setup.address}</code>.
          </p>
        ) : null}
      </section>

      <TeachYourForm onChange={() => load()} setup={setup} waiting={waiting} />
    </div>
  );
}

/**
 * Step 3: submit your own form once. What StudioCue read is shown field by
 * field; the studio's corrections are saved as how that form is read.
 */
function TeachYourForm({
  setup,
  waiting,
  onChange,
}: {
  setup: Setup;
  waiting: boolean;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const test = setup.lastTest;
  const fresh = withinDay(test?.receivedAt);

  async function start(cancel = false) {
    setBusy(true);
    setNotice(null);
    try {
      await sendCommunicationsCommand({
        type: "startCaptureTest",
        idempotencyKey: `capture_test_${Date.now()}`,
        input: { cancel },
      });
      onChange();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The test could not be started."));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!test) return;
    setBusy(true);
    setNotice(null);
    try {
      const full = Object.fromEntries(
        test.fields.map((field) => [
          field.normalisedLabel,
          mapping[field.normalisedLabel] ?? field.key ?? "ignore",
        ]),
      );
      await sendCommunicationsCommand({
        type: "saveFormMapping",
        idempotencyKey: `form_mapping_${test.formKey}_${Date.now()}`,
        input: {
          formKey: test.formKey,
          formLabel: test.formName ?? test.builderLabel,
          mapping: full,
        },
      });
      setNotice("Saved. Every inquiry from this form will be read this way.");
      onChange();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The form's fields could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h4>3. Send a test inquiry</h4>
      {waiting ? (
        <p className="lead-capture-waiting">
          <LoaderCircle className="spin" size={14} /> Now fill in your own website
          form. The next email that reaches StudioCue will show up here, and
          won&apos;t become an inquiry.{" "}
          <button className="button button-light button-sm" disabled={busy} onClick={() => void start(true)} type="button">
            Cancel
          </button>
        </p>
      ) : (
        <p>
          Fill in your own form once and check we read it right.{" "}
          <button className="button button-dark button-sm" disabled={busy} onClick={() => void start()} type="button">
            <Send size={14} /> Start the test
          </button>
        </p>
      )}
      {fresh && test ? (
        <div className="lead-capture-test">
          <p>
            <strong>Received {ago(test.receivedAt)}</strong> — {test.builderLabel}
            {test.formName ? ` · ${test.formName}` : ""}. Here&apos;s what each field became:
          </p>
          {test.fields.length ? (
            <table>
              <thead>
                <tr><th>Your form&apos;s field</th><th>What they wrote</th><th>Goes to</th></tr>
              </thead>
              <tbody>
                {test.fields.map((field) => (
                  <tr key={field.normalisedLabel}>
                    <td>{field.label}</td>
                    <td>{field.value}</td>
                    <td>
                      <select
                        aria-label={`Where "${field.label}" goes`}
                        onChange={(event) =>
                          setMapping({ ...mapping, [field.normalisedLabel]: event.target.value })
                        }
                        value={mapping[field.normalisedLabel] ?? field.key ?? "ignore"}
                      >
                        {FIELD_CHOICES.map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="form-notice">
              We couldn&apos;t find labelled fields in that email. It will still
              become an inquiry, read from its text.
            </p>
          )}
          {test.fields.length ? (
            <button className="button button-dark button-sm" disabled={busy} onClick={() => void save()} type="button">
              <Check size={14} /> Looks right — save
            </button>
          ) : null}
        </div>
      ) : null}
      {setup.forms.length ? (
        <small>
          Forms StudioCue knows: {setup.forms.map((form) => form.label ?? "Unnamed form").join(", ")}
        </small>
      ) : null}
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </section>
  );
}
