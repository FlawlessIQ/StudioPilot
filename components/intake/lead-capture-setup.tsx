"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  FlaskConical,
  Forward,
  Inbox,
  Info,
  LayoutTemplate,
  LoaderCircle,
  MailPlus,
  Send,
} from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { sendCommunicationsCommand } from "@/lib/communications/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import {
  FORM_SOURCES,
  GMAIL_FORWARDING_SETTINGS,
  OUTLOOK_RULES,
  gmailFilterQuery,
  gmailSearchLink,
  senderDomains,
  type FormSource,
} from "@/features/intake/forwarding-filters";
import { NOTIFICATION_GUIDES, type NotificationGuide } from "@/features/intake/form-notification-guides";

/**
 * Studio settings → Inquiry capture.
 *
 * Three ways an inquiry reaches StudioCue, offered side by side because
 * studios differ in what they will touch:
 *  - the website form emails StudioCue directly (one field in the builder);
 *  - the studio's inbox forwards form emails on (a Gmail filter or Outlook rule);
 *  - the studio forwards one by hand, whenever it likes.
 *
 * The panel itself is a status line, the address, and three rows. Every
 * instruction lives in a sheet, one step per screen, so the settings page
 * stays short and a step is read when it is being done — not before.
 */

type TestField = { label: string; normalisedLabel: string; value: string; key: string | null };

export type LeadCaptureSetupState = {
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

export type LeadCaptureActions = {
  refresh: () => void;
  checkMailbox: (email: string) => void;
  startTest: (cancel?: boolean) => Promise<void>;
  saveMapping: (mapping: Record<string, string>) => Promise<void>;
};

type SheetKey = "form" | "inbox" | "manual" | "test";

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

type MailFamily = "google" | "microsoft" | "other";

function familyOf(provider: string | undefined): MailFamily | null {
  if (provider === "gmail" || provider === "google_workspace") return "google";
  if (provider === "microsoft_365" || provider === "outlook_com") return "microsoft";
  return provider ? "other" : null;
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
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

/* ── Container: loads the setup and runs its commands ─────────────────── */

export function LeadCaptureSetup() {
  const workspace = useWorkspace();
  const [setup, setSetup] = useState<LeadCaptureSetupState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  // Bumped to read again: after a change, a "check again", or on a timer.
  const [reads, setReads] = useState(0);
  const [mailboxQuery, setMailboxQuery] = useState<string | null>(null);
  const refresh = useCallback(() => setReads((count) => count + 1), []);

  useEffect(() => {
    if (!workspace.tenantId) return;
    let active = true;
    sendCommunicationsCommand({
      type: "getLeadCaptureSetup",
      idempotencyKey: `lead_capture_setup_${reads}`,
      input: { mailbox: mailboxQuery },
    })
      .then((result) => {
        if (!active) return;
        if (result.mode === "live") setSetup(result.payload as LeadCaptureSetupState);
        else setUnavailable(true);
      })
      .catch((caught: unknown) => {
        if (active) setError(friendlyError(caught, "Inquiry capture settings could not be loaded."));
      });
    return () => {
      active = false;
    };
  }, [workspace.tenantId, reads, mailboxQuery]);

  // While a test is running, look again every few seconds so it completes on
  // screen without a refresh.
  const waiting = isAhead(setup?.testWindowUntil);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [waiting, refresh]);

  const actions = useMemo<LeadCaptureActions>(
    () => ({
      refresh,
      checkMailbox(email) {
        setMailboxQuery(email.trim() || null);
        refresh();
      },
      async startTest(cancel = false) {
        await sendCommunicationsCommand({
          type: "startCaptureTest",
          idempotencyKey: `capture_test_${Date.now()}`,
          input: { cancel },
        });
        refresh();
      },
      async saveMapping(mapping) {
        const test = setup?.lastTest;
        if (!test) return;
        await sendCommunicationsCommand({
          type: "saveFormMapping",
          idempotencyKey: `form_mapping_${test.formKey}_${Date.now()}`,
          input: {
            formKey: test.formKey,
            formLabel: test.formName ?? test.builderLabel,
            mapping,
          },
        });
        refresh();
      },
    }),
    [refresh, setup?.lastTest],
  );

  if (unavailable)
    return (
      <p className="form-notice">Inquiry capture is not available on this workspace yet.</p>
    );
  return <LeadCaptureView actions={actions} error={error} setup={setup} />;
}

/* ── The panel ────────────────────────────────────────────────────────── */

const ROUTES: Array<{
  key: Exclude<SheetKey, "test">;
  icon: ComponentType<{ size?: number }>;
  title: string;
  subtitle: string;
  badge?: string;
}> = [
  {
    key: "form",
    icon: LayoutTemplate,
    title: "From your website form",
    subtitle: "Wix, WordPress or Jotform: one setting",
    badge: "Easiest",
  },
  {
    key: "inbox",
    icon: MailPlus,
    title: "From your inbox",
    subtitle: "A Gmail filter or Outlook rule",
  },
  {
    key: "manual",
    icon: Forward,
    title: "Forward by hand",
    subtitle: "Any email, one at a time",
  },
];

export function LeadCaptureView({
  setup,
  actions,
  error = null,
  initialSheet = null,
}: {
  setup: LeadCaptureSetupState | null;
  actions: LeadCaptureActions;
  error?: string | null;
  initialSheet?: SheetKey | null;
}) {
  const [sheet, setSheet] = useState<SheetKey | null>(initialSheet);
  const close = useCallback(() => setSheet(null), []);
  const address = setup?.address ?? null;
  const knownForms = (setup?.forms ?? []).map((form) => form.label ?? "Unnamed form");
  const live = Boolean(setup?.lastCaptureAt);

  return (
    <section aria-labelledby="inquiry-capture-title" className="panel capture-panel" id="inquiry-capture">
      <div className="email-branding-heading">
        <span className="data-control-icon">
          <Inbox aria-hidden="true" />
        </span>
        <div>
          <p className="eyebrow">Inquiries</p>
          <h2 id="inquiry-capture-title">Inquiry capture</h2>
          <p>Inquiries land here filled in, with a reply drafted.</p>
        </div>
      </div>

      {error ? <p className="form-notice">{error}</p> : null}

      <div className="capture-status" aria-live="polite">
        <span aria-hidden="true" className={live ? "capture-dot is-live" : "capture-dot"} />
        <span className="capture-status-text">
          <strong>{setup ? (live ? `Last inquiry ${ago(setup.lastCaptureAt)}` : "Nothing captured yet") : "Checking…"}</strong>
          {knownForms.length ? <small>Reads {knownForms.join(", ")}</small> : null}
        </span>
        <button
          className="button button-light button-sm"
          disabled={!address}
          onClick={() => setSheet("test")}
          type="button"
        >
          <FlaskConical size={14} /> Test
        </button>
      </div>

      <div className="capture-address">
        <small>Your StudioCue address</small>
        <code>{address ?? "…"}</code>
        {address ? <Copyable label="Copy" value={address} /> : null}
      </div>

      <div className="capture-routes">
        {ROUTES.map((route) => (
          <button
            className="settings-row capture-route"
            disabled={!address}
            key={route.key}
            onClick={() => setSheet(route.key)}
            type="button"
          >
            <span className="settings-row-icon">
              <route.icon size={18} />
            </span>
            <span className="settings-row-text">
              <strong>
                {route.title}
                {route.badge ? <em className="capture-badge">{route.badge}</em> : null}
              </strong>
              <small>{route.subtitle}</small>
            </span>
            <ChevronRight aria-hidden="true" className="settings-row-chev" size={18} />
          </button>
        ))}
      </div>

      {setup && address ? (
        <>
          <SheetDialog label="From your website form" onClose={close} open={sheet === "form"}>
            <FormRoute
              actions={actions}
              address={address}
              onDone={close}
              onUseInbox={() => setSheet("inbox")}
              setup={setup}
            />
          </SheetDialog>
          <SheetDialog label="From your inbox" onClose={close} open={sheet === "inbox"}>
            <InboxRoute actions={actions} address={address} onDone={close} setup={setup} />
          </SheetDialog>
          <SheetDialog label="Forward by hand" onClose={close} open={sheet === "manual"}>
            <ManualRoute address={address} onDone={close} />
          </SheetDialog>
          <SheetDialog label="Send a test inquiry" onClose={close} open={sheet === "test"}>
            <div className="capture-sheet">
              <header>
                <p className="eyebrow">Check it works</p>
                <h3>Send a test inquiry</h3>
              </header>
              <TestStep actions={actions} setup={setup} />
              <footer>
                <span />
                <button className="button button-dark" onClick={close} type="button">Done</button>
              </footer>
            </div>
          </SheetDialog>
        </>
      ) : null}
    </section>
  );
}

/* ── Building blocks ──────────────────────────────────────────────────── */

type Step = { title: string; body: ReactNode; ready?: boolean };

/** One step per screen, with a progress bar and Back / Next. */
function Steps({ eyebrow, steps, onDone }: { eyebrow: string; steps: Step[]; onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const at = Math.min(index, steps.length - 1);
  const step = steps[at];
  const last = at === steps.length - 1;
  return (
    <div className="capture-sheet">
      <header>
        <p className="eyebrow">{eyebrow}</p>
        <ol aria-label={`Step ${at + 1} of ${steps.length}`} className="capture-progress">
          {steps.map((item, position) => (
            <li className={position < at ? "is-done" : position === at ? "is-current" : undefined} key={item.title} />
          ))}
        </ol>
        <h3>
          <span className="capture-step-number">{at + 1}</span>
          {step.title}
        </h3>
      </header>
      <div className="capture-step">{step.body}</div>
      <footer>
        {at > 0 ? (
          <button className="button button-light" onClick={() => setIndex(at - 1)} type="button">Back</button>
        ) : (
          <span />
        )}
        {last ? (
          <button className="button button-dark" onClick={onDone} type="button">Done</button>
        ) : (
          <button className="button button-dark" disabled={step.ready === false} onClick={() => setIndex(at + 1)} type="button">
            Next
          </button>
        )}
      </footer>
    </div>
  );
}

/** A click path in someone else's app, as chips: Settings › Mail › Rules. */
function Path({ steps }: { steps: string[] }) {
  return (
    <ol className="capture-path">
      {steps.map((step) => (
        <li key={step}>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <p className="capture-tip">
      <Info aria-hidden="true" size={14} />
      <span>{children}</span>
    </p>
  );
}

function OpenLink({ href, label }: { href: string; label: string }) {
  return (
    <a className="button button-light button-sm" href={href} rel="noreferrer" target="_blank">
      {label} <ExternalLink size={12} />
    </a>
  );
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

/** The thing to paste, big enough to read and one tap to copy. */
function Pasteable({ value, label }: { value: string; label: string }) {
  return (
    <div className="capture-paste">
      <code>{value}</code>
      <Copyable label={label} value={value} />
    </div>
  );
}

function Chips<T extends string>({
  options,
  selected,
  onToggle,
  label,
}: {
  options: ReadonlyArray<{ key: T; label: string }>;
  selected: readonly T[];
  onToggle: (key: T) => void;
  label: string;
}) {
  return (
    <div aria-label={label} className="capture-chips" role="group">
      {options.map((option) => {
        const on = selected.includes(option.key);
        return (
          <button
            aria-pressed={on}
            className={on ? "capture-chip is-on" : "capture-chip"}
            key={option.key}
            onClick={() => onToggle(option.key)}
            type="button"
          >
            {on ? <Check aria-hidden="true" size={13} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Route 1: the website form emails StudioCue ───────────────────────── */

function FormRoute({
  setup,
  address,
  actions,
  onDone,
  onUseInbox,
}: {
  setup: LeadCaptureSetupState;
  address: string;
  actions: LeadCaptureActions;
  onDone: () => void;
  onUseInbox: () => void;
}) {
  const [builder, setBuilder] = useState<NotificationGuide["key"] | null>(null);
  const guide = NOTIFICATION_GUIDES.find((item) => item.key === builder) ?? null;

  const pick: Step = {
    title: "Which website builder?",
    ready: Boolean(guide),
    body: (
      <Chips
        label="Website builder"
        onToggle={(key) => setBuilder(key)}
        options={NOTIFICATION_GUIDES}
        selected={builder ? [builder] : []}
      />
    ),
  };

  if (guide && !guide.supported) {
    return (
      <Steps
        eyebrow="From your website form"
        onDone={onDone}
        steps={[
          pick,
          {
            title: `${guide.label} can't do this`,
            body: (
              <>
                <p className="capture-lead">{guide.note}</p>
                <button className="button button-dark button-sm" onClick={onUseInbox} type="button">
                  <MailPlus size={14} /> Use your inbox instead
                </button>
              </>
            ),
          },
        ]}
      />
    );
  }

  return (
    <Steps
      eyebrow="From your website form"
      onDone={onDone}
      steps={[
        pick,
        {
          title: "Add your StudioCue address",
          body: guide ? (
            <>
              <Pasteable label="Copy" value={address} />
              <Path steps={guide.path} />
              {guide.link ? <OpenLink href={guide.link} label={`Open ${guide.label}`} /> : null}
              {guide.note ? <Tip>{guide.note}</Tip> : null}
            </>
          ) : null,
        },
        { title: "Send a test", body: <TestStep actions={actions} setup={setup} /> },
      ]}
    />
  );
}

/* ── Route 2: the inbox forwards form emails on ───────────────────────── */

const FAMILY_OPTIONS: ReadonlyArray<{ key: MailFamily; label: string }> = [
  { key: "google", label: "Gmail" },
  { key: "microsoft", label: "Outlook" },
  { key: "other", label: "Something else" },
];

function InboxRoute({
  setup,
  address,
  actions,
  onDone,
}: {
  setup: LeadCaptureSetupState;
  address: string;
  actions: LeadCaptureActions;
  onDone: () => void;
}) {
  const [email, setEmail] = useState(setup.mailbox?.email ?? "");
  const detected = familyOf(setup.mailbox?.provider);
  const [chosen, setChosen] = useState<MailFamily | null>(null);
  const family = chosen ?? detected ?? "google";
  const [sources, setSources] = useState<FormSource[]>([]);
  const query = gmailFilterQuery(sources);
  const senders = senderDomains(sources);

  const steps: Step[] = [
    {
      title: "Your inbox",
      body: (
        <>
          <form
            className="capture-inline"
            onSubmit={(event) => {
              event.preventDefault();
              setChosen(null);
              actions.checkMailbox(email);
            }}
          >
            <input
              aria-label="The address your website form emails"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="hello@yourstudio.com"
              type="email"
              value={email}
            />
            <button className="button button-light button-sm" type="submit">Check</button>
          </form>
          <Chips
            label="Email provider"
            onToggle={(key) => setChosen(key)}
            options={FAMILY_OPTIONS}
            selected={[family]}
          />
          {setup.mailbox?.provider === "microsoft_365" ? (
            <Tip>Microsoft 365 often blocks forwarding. Your IT admin may need to allow it.</Tip>
          ) : null}
        </>
      ),
    },
    {
      title: "Where do inquiries come from?",
      ready: sources.length > 0,
      body: (
        <Chips
          label="Inquiry sources"
          onToggle={(key) =>
            setSources((current) => (current.includes(key) ? current.filter((value) => value !== key) : [...current, key]))
          }
          options={FORM_SOURCES}
          selected={sources}
        />
      ),
    },
  ];

  if (family === "google") {
    const code = setup.forwardingConfirmation?.code;
    steps.push(
      {
        title: "Add a forwarding address",
        body: (
          <>
            <Pasteable label="Copy" value={address} />
            <Path steps={["Settings", "Forwarding and POP/IMAP", "Add a forwarding address"]} />
            <OpenLink href={GMAIL_FORWARDING_SETTINGS} label="Open Gmail settings" />
          </>
        ),
      },
      {
        title: "Confirm it",
        body: code ? (
          <>
            <Pasteable label="Copy code" value={code} />
            <Path steps={["Paste the code in Gmail", "Verify"]} />
            {setup.forwardingConfirmation?.link ? (
              <OpenLink href={setup.forwardingConfirmation.link} label="Or confirm in Gmail" />
            ) : null}
          </>
        ) : (
          <WaitingForCode onPoll={actions.refresh} />
        ),
      },
      {
        title: "Create the filter",
        body: (
          <>
            <Pasteable label="Copy search" value={query} />
            <Path steps={["Search options ▾", "Create filter", "Forward it to", "your StudioCue address"]} />
            <OpenLink href={gmailSearchLink(query)} label="Open in Gmail" />
          </>
        ),
      },
    );
  } else {
    steps.push({
      title: family === "microsoft" ? "Add an Outlook rule" : "Add a forwarding rule",
      body: (
        <>
          <p className="capture-lead">Forward mail from:</p>
          <div className="capture-chips">
            {senders.map((sender) => (
              <span className="capture-chip is-static" key={sender}>{sender}</span>
            ))}
          </div>
          <p className="capture-lead">To:</p>
          <Pasteable label="Copy" value={address} />
          {family === "microsoft" ? (
            <>
              <Path steps={["Settings", "Mail", "Rules", "Add new rule", "Forward to"]} />
              <OpenLink href={OUTLOOK_RULES} label="Open Outlook rules" />
            </>
          ) : null}
        </>
      ),
    });
  }

  steps.push({ title: "Send a test", body: <TestStep actions={actions} setup={setup} /> });
  return <Steps eyebrow="From your inbox" onDone={onDone} steps={steps} />;
}

/** Gmail's code lands at StudioCue within seconds; look for it until it does. */
function WaitingForCode({ onPoll }: { onPoll: () => void }) {
  useEffect(() => {
    const timer = window.setInterval(onPoll, 5000);
    return () => window.clearInterval(timer);
  }, [onPoll]);
  return (
    <p className="capture-waiting">
      <LoaderCircle className="spin" size={16} /> Waiting for Gmail&apos;s code…
    </p>
  );
}

/* ── Route 3: forward by hand ─────────────────────────────────────────── */

function ManualRoute({ address, onDone }: { address: string; onDone: () => void }) {
  return (
    <div className="capture-sheet">
      <header>
        <p className="eyebrow">Forward by hand</p>
        <h3>Forward any inquiry here</h3>
      </header>
      <div className="capture-step">
        <Pasteable label="Copy" value={address} />
        <ul className="capture-facts">
          <li><Forward aria-hidden="true" size={16} /> Emails, The Knot, WeddingWire, Zola</li>
          <li><Check aria-hidden="true" size={16} /> Becomes an inquiry, date checked</li>
          <li><Send aria-hidden="true" size={16} /> Reply drafted for you to approve</li>
        </ul>
        <Tip>The couple isn&apos;t emailed.</Tip>
      </div>
      <footer>
        <span />
        <button className="button button-dark" onClick={onDone} type="button">Done</button>
      </footer>
    </div>
  );
}

/* ── The test: submit your own form once ──────────────────────────────── */

/**
 * The next email to reach StudioCue is shown field by field instead of
 * becoming an inquiry; the studio's corrections become how that form is read.
 */
function TestStep({ setup, actions }: { setup: LeadCaptureSetupState; actions: LeadCaptureActions }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const waiting = isAhead(setup.testWindowUntil);
  const test = withinDay(setup.lastTest?.receivedAt) ? setup.lastTest : null;

  async function run(work: () => Promise<void>, failure: string, success?: string) {
    setBusy(true);
    setNotice(null);
    try {
      await work();
      if (success) setNotice(success);
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="capture-test">
      {waiting ? (
        <div className="capture-waiting">
          <LoaderCircle className="spin" size={16} />
          <span><strong>Fill in your website form now.</strong> It shows up here.</span>
          <button
            className="button button-light button-sm"
            disabled={busy}
            onClick={() => void run(() => actions.startTest(true), "The test could not be cancelled.")}
            type="button"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          className={test ? "button button-light button-sm" : "button button-dark"}
          disabled={busy}
          onClick={() => void run(() => actions.startTest(), "The test could not be started.")}
          type="button"
        >
          <Send size={14} /> {test ? "Test again" : "Start the test"}
        </button>
      )}

      {test ? (
        <>
          <p className="capture-received">
            <Check aria-hidden="true" size={15} /> Received {ago(test.receivedAt)} · {test.formName ?? test.builderLabel}
          </p>
          {test.fields.length ? (
            <>
              <ul className="capture-fields">
                {test.fields.map((field) => (
                  <li key={field.normalisedLabel}>
                    <span>
                      <small>{field.label}</small>
                      <strong>{field.value || "—"}</strong>
                    </span>
                    <select
                      aria-label={`Where "${field.label}" goes`}
                      onChange={(event) => setMapping({ ...mapping, [field.normalisedLabel]: event.target.value })}
                      value={mapping[field.normalisedLabel] ?? field.key ?? "ignore"}
                    >
                      {FIELD_CHOICES.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
              <button
                className="button button-dark button-sm"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      actions.saveMapping(
                        Object.fromEntries(
                          test.fields.map((field) => [
                            field.normalisedLabel,
                            mapping[field.normalisedLabel] ?? field.key ?? "ignore",
                          ]),
                        ),
                      ),
                    "The form's fields could not be saved.",
                    "Saved. This form is read this way from now on.",
                  )
                }
                type="button"
              >
                <Check size={14} /> Looks right
              </button>
            </>
          ) : (
            <Tip>No labelled fields found. It still becomes an inquiry, read from its text.</Tip>
          )}
        </>
      ) : null}
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </div>
  );
}
